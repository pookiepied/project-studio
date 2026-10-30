import { conversationKey, isRecord } from "../serve/stdio.js";
import { bareTool, conversationActor, DesktopControl, type Actor, type ActorRole } from "./control.js";
import { staleReasons } from "./observations.js";
import { VOICE_BATCH_STEPS, VOICE_COMPUTER_TOOLS } from "../contracts/voice-computer.js";
import { ComputerError } from "./errors.js";
import { ComputerSession } from "./session.js";
import { reachOf, toolByName, type ToolAnswer } from "./tools.js";
import { ApprovalBook, approvalIdFrom, targetFrom, type ApprovalRequest, type ApprovalTarget } from "./approvals.js";
import { sampleFrom, ScreenWatch, type DrawnShape } from "./screen-watch.js";
import { displaysFrom } from "./marks.js";

/** How long a pause waits for held input to be let go before saying it is still pending. */
const RELEASE_WAIT_MS = 5_000;

/** How often the pointer and front window are sampled while the screen is shared. */
const PULSE_MS = 500;

/** Failed samples in a row after which the watch stops and says so, rather than retrying forever. */
const PULSE_FAILURES = 3;

/** The most shapes one drawing report may carry. */
const MAX_DRAWN = 12;

interface Watching {
  readonly watch: ScreenWatch;
  readonly timer: NodeJS.Timeout | undefined;
  inflight: boolean;
  failures: number;
}

function isShape(value: unknown): value is DrawnShape["shape"] {
  return value === "loop" || value === "line" || value === "dot" || value === "scribble";
}

/** Conversations whose latest picture is kept; older ones drop theirs. */
const MAX_PICTURED_CONVERSATIONS = 8;


function isRole(value: unknown): value is ActorRole {
  return value === "conversation" || value === "voice" || value === "worker";
}

/**
 * The actor a call names in `_meta`, set by the harness from its own
 * execution context - never by a model, and never by a third party, who
 * cannot reach this server. A call without it is its conversation's own.
 */
export function actorFrom(meta: unknown): Actor {
  const conversation = conversationKey(meta);
  if (!isRecord(meta)) return conversationActor(conversation);
  const id = typeof meta["studio/actor"] === "string" && meta["studio/actor"] !== "" ? meta["studio/actor"] : conversation;
  const role = isRole(meta["studio/role"]) ? meta["studio/role"] : "conversation";
  const name = typeof meta["studio/actor-name"] === "string" ? meta["studio/actor-name"].slice(0, 64) : undefined;
  return { conversation, id, role, ...(name === undefined ? {} : { name }) };
}

/**
 * Whether the harness says the person is sharing the screen, carried on each
 * voice call so a server started after sharing was turned on still knows.
 * Turning it off also arrives on its own, so a call already running sees it.
 */
function sharingFrom(meta: unknown): boolean | undefined {
  if (!isRecord(meta)) return undefined;
  const said = meta["studio/sharing"];
  return said === "on" ? true : said === "off" ? false : undefined;
}

function actorKey(actor: Actor): string {
  return actor.id;
}

/**
 * The turn a call belongs to: the harness's submission id, stamped from its
 * own execution context. A model never spells it, so a turn boundary does
 * not depend on the model saying one happened (P1-5).
 */
function turnFrom(meta: unknown): string | undefined {
  if (!isRecord(meta)) return undefined;
  const turn = meta["studio/turn"];
  return typeof turn === "string" && turn !== "" ? turn : undefined;
}

/** Who an approval is for: one actor of one conversation. */
function approvalActor(actor: Actor): string {
  return `${actor.conversation}\u0000${actor.id}`;
}

/** What a model reads while the person is asked, or if nobody can ask them. */
function askedSentence(request: ApprovalRequest): string {
  return `No input was sent: this would reach ${request.displayName}, and Studio asks the person before that. ` +
    "It goes ahead only if they agree; do not try to reach it another way.";
}

/** Tools whose answer hands out element references from the driver's memory. */
const READS_REFS = new Set(["read_ui", "status"]);

/** Whether the person's own clicks, keys or wheel turned up in an answer. */
function sawHumanInput(answer: ToolAnswer): boolean {
  const input = answer.structuredContent?.["userInput"];
  if (!isRecord(input)) return false;
  return [input["buttons"], input["keys"], input["wheels"]].some((count) => typeof count === "number" && count > 0);
}

export type ReleaseOutcome = "released" | "not_running" | "pending" | "failed";

/**
 * The computer server's state, apart from the stdio wire: one driver per
 * conversation, one desktop lease over all of them. Kept out of `server.ts`
 * so the routing can be exercised without spawning a process.
 */
export class ComputerService {
  readonly #sessions = new Map<string, ComputerSession>();
  readonly #sharing = new Set<string>();
  readonly #sharingEpochs = new Map<string, number>();
  readonly #pictured = new Set<string>();
  readonly #watches = new Map<string, Watching>();
  /** Conversations whose watch gave up, so the turn's context can say live updates are unavailable. */
  readonly #unwatchable = new Set<string>();
  readonly desktop = new DesktopControl();
  readonly #approvals = new ApprovalBook();
  /** Who last read the element references each conversation's driver holds. */
  readonly #refsReader = new Map<string, string>();
  readonly #create: (key: string) => ComputerSession;
  readonly #pulseMs: number;

  /** `pulseMs` 0 keeps the watch's events (drawings) without sampling, for tests about something else. */
  constructor(create: (key: string) => ComputerSession = (key) => new ComputerSession(key), pulseMs = PULSE_MS) {
    this.#create = create;
    this.#pulseMs = pulseMs;
  }

  session(conversation: string): ComputerSession {
    const existing = this.#sessions.get(conversation);
    if (existing !== undefined) return existing;
    const created = this.#create(conversation);
    created.onPersonStop(() => this.#personStop());
    this.#sessions.set(conversation, created);
    return created;
  }

  async call(name: string, args: Record<string, unknown>, meta: unknown, signal?: AbortSignal): Promise<ToolAnswer> {
    const tool = toolByName(name);
    // Unreachable through `serveStdio`, which asks `has` first; kept as a
    // typed refusal so the taxonomy holds even for the impossible branch.
    if (tool === undefined) throw new ComputerError("bad_input", { message: `There is no tool called "${name}".` });
    const actor = actorFrom(meta);
    const session = this.session(actor.conversation);
    const context = { actor, desktop: this.desktop, signal };
    const sharing = actor.role === "voice" ? sharingFrom(meta) : undefined;
    if (sharing !== undefined) this.setSharing(actor.conversation, sharing);
    const voiceRefusal = this.#voiceRefusal(actor, name, args);
    if (voiceRefusal !== undefined) return voiceRefusal;
    // Marks are drawn by the window showing this conversation, from its own
    // transcript; a task's calls are not in it, so its marks would be
    // reported shown and never appear.
    if (actor.role === "worker" && name === "studio_computer_mark") {
      return { isError: true, content: [{ type: "text", text: "Marks are shown for the agent the person is talking with, not for tasks. Say where things are in your answer instead." }] };
    }
    // Stop bypasses the queue so cancellation invalidates queued input, and
    // fences the lease first so nothing queued slips in before the driver ends.
    if (name === "studio_computer_stop") {
      this.desktop.stopping(actor.conversation);
      return tool.run(session, args, context);
    }
    // Control waits outside the queue too: a paused worker's wait must not
    // hold up the voice agent's screenshot in the same conversation.
    const sharedAt = this.#sharingEpoch(actor.conversation);
    if (name === "studio_computer_control") return this.#withinSharing(actor, sharedAt, await tool.run(session, args, context));
    const ticket = this.desktop.ticket(actor);
    const newTurn = this.desktop.beginTurn(actor, turnFrom(meta));
    this.#approvals.accept(approvalIdFrom(meta), approvalActor(actor));
    try {
      const answer = await session.runTool(async () => {
        // A new turn ends the references its actor read in the last one.
        if (newTurn && session.running && this.#refsReader.get(actor.conversation) === actor.id) {
          await session.request("reset_refs");
          this.#refsReader.delete(actor.conversation);
        }
        const gated = await this.#gate(session, actor, name, args, ticket);
        if (gated.request !== undefined) {
          return {
            isError: true,
            content: [{ type: "text", text: askedSentence(gated.request) }],
            structuredContent: { approvalRequest: gated.request, desktop: this.desktop.state(actor) },
          };
        }
        const gate = async (step: string, stepArgs: Record<string, unknown>): Promise<{ refusal?: string; allowPassword?: boolean }> => {
          const checked = await this.#gate(session, actor, step, stepArgs, undefined);
          return checked.request === undefined
            ? { allowPassword: checked.allowPassword === true }
            : { refusal: `This step would reach ${checked.request.displayName}, and Studio asks the person before that, so it and the steps after it were not sent. Send that step on its own so the person can be asked.` };
        };
        const granted = { ...context, allowPassword: gated.allowPassword === true, gate };
        return this.desktop.run(session, name, () => tool.run(session, args, granted), actor, args, ticket);
      }, actorKey(actor));
      this.#commit(session, actor, sharedAt, name);
      if (sawHumanInput(answer)) this.desktop.noteHumanInput();
      return this.#withinSharing(actor, sharedAt, { ...answer, structuredContent: { ...answer.structuredContent, desktop: this.desktop.state(actor) } });
    } catch (error) {
      this.#commit(session, actor, sharedAt, name);
      if (error instanceof ComputerError && error.desktop !== undefined) {
        return { isError: true, content: [{ type: "text", text: error.message }], structuredContent: { desktop: error.desktop } };
      }
      throw error;
    }
  }

  /**
   * What the conversation's own agent may do in a voice call, checked here
   * as well as by the harness's tool list: sharing must be on to look or
   * act, and a batch stays short enough to keep the conversation responsive.
   */
  #voiceRefusal(actor: Actor, name: string, args: Record<string, unknown>): ToolAnswer | undefined {
    if (actor.role !== "voice") return undefined;
    const bare = bareTool(name);
    if (!VOICE_COMPUTER_TOOLS.has(bare)) {
      return { isError: true, content: [{ type: "text", text: `In a voice conversation ${name} is not offered. Hand this to a task with voice_work.` }] };
    }
    const harmless = bare === "control" && (args["action"] === "status" || args["action"] === "release" || args["action"] === "wait");
    if (!harmless && !this.#sharing.has(actor.conversation)) {
      return { isError: true, content: [{ type: "text", text: "Screen sharing is off for this call, so nothing was looked at or sent. Ask the person to turn on Share screen in the call, or hand the work to a task." }], structuredContent: { sharing: false } };
    }
    if (bare === "batch" && Array.isArray(args["steps"]) && args["steps"].length > VOICE_BATCH_STEPS) {
      return { isError: true, content: [{ type: "text", text: `In a conversation a batch runs at most ${String(VOICE_BATCH_STEPS)} steps, so the call stays responsive. Nothing was sent. Hand longer work to a task with voice_work.` }] };
    }
    return undefined;
  }

  /**
   * A picture finished after the person stopped sharing is not delivered to
   * the voice agent: the call's images are dropped and it is told so.
   */
  #withinSharing(actor: Actor, sharedAt: number, answer: ToolAnswer): ToolAnswer {
    if (actor.role !== "voice" || this.#sharingEpoch(actor.conversation) === sharedAt) return answer;
    return {
      ...answer,
      content: [...answer.content.filter((block) => block.type !== "image"),
        { type: "text", text: "Screen sharing ended while this call ran, so its picture was discarded. Input already sent stays sent." }],
    };
  }

  /**
   * Whether the person must be asked before this call's input is sent
   * (P1-4), decided before the lease admits it: a refused call has sent
   * nothing and counted as no input, so the frame it named still holds once
   * the person has answered. Input the lease would refuse anyway is not put
   * to the person. A batch step is checked with no ticket, inside its batch.
   */
  async #gate(
    session: ComputerSession,
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
    ticket: ReturnType<DesktopControl["ticket"]> | undefined,
  ): Promise<{ readonly request?: ApprovalRequest; readonly allowPassword?: boolean }> {
    const reach = reachOf(name, args, { actor, desktop: this.desktop });
    if (reach === undefined) return {};
    if (ticket !== undefined && this.desktop.wouldRefuse(actor, name, args, ticket) !== undefined) return {};
    let target: ApprovalTarget | undefined;
    if ("category" in reach) target = { category: reach.category, app: "", pid: 0, processStarted: "" };
    else {
      target = targetFrom(await session.request("sensitivity", reach.probe));
      // The person's own input since the last answer - a click on Studio's
      // own approval prompt among it - leaves the pictured screen behind, so
      // the lease hears of it before it admits anything.
      if (session.humanInputInCall) this.desktop.noteHumanInput();
    }
    if (target === undefined) return {};
    const key = approvalActor(actor);
    if (this.#approvals.take(key, target)) return { allowPassword: target.category === "password_field" };
    return { request: this.#approvals.ask(key, target) };
  }

  /** The person held Escape while Studio acted: pause everything, and let go of anything held. */
  #personStop(): void {
    const owner = this.desktop.ownerSession;
    if (this.desktop.personStop() === "paused") void this.#releaseHeld(owner);
  }

  /** The call's picture becomes the conversation's shared observation, with who took it. */
  #commit(session: ComputerSession, actor: Actor, sharedAt: number, name: string): void {
    if (READS_REFS.has(bareTool(name))) this.#refsReader.set(actor.conversation, actor.id);
    const offered = session.takeOffered();
    const frames = session.takeOfferedFrames();
    // A picture discarded because sharing ended was never seen, so its frame admits nothing.
    if (actor.role === "voice" && this.#sharingEpoch(actor.conversation) !== sharedAt) return;
    for (const frame of frames) this.desktop.recordFrame(actor, frame);
    if (offered === undefined) return;
    session.commitObservation({
      ...offered,
      by: { role: actor.role, id: actor.id, ...(actor.name === undefined ? {} : { name: actor.name }) },
      changes: this.desktop.changes,
    });
    // One picture per conversation, and pictures for only the most recent
    // few conversations: the bytes are the only unbounded part.
    this.#pictured.delete(actor.conversation);
    this.#pictured.add(actor.conversation);
    while (this.#pictured.size > MAX_PICTURED_CONVERSATIONS) {
      const oldest = this.#pictured.values().next().value;
      if (oldest === undefined) break;
      this.#pictured.delete(oldest);
      this.#sessions.get(oldest)?.commitObservation(undefined);
    }
  }

  #sharingEpoch(conversation: string): number {
    return this.#sharingEpochs.get(conversation) ?? 0;
  }

  /** Turns the voice call's screen sharing on or off; off discards the shared picture's future deliveries. */
  setSharing(conversation: string, on: boolean): void {
    if (on === this.#sharing.has(conversation)) return;
    if (on) this.#sharing.add(conversation);
    else this.#sharing.delete(conversation);
    this.#sharingEpochs.set(conversation, this.#sharingEpoch(conversation) + 1);
    if (on) this.#watch(conversation);
    else this.#unwatch(conversation);
  }

  /**
   * Samples the pointer, the front window and the person's input counts
   * twice a second while the screen is shared, and only then: sharing is
   * the person's switch, and off means nothing is sampled. A sample never
   * waits behind a running call - it is skipped - so watching never slows
   * the work it watches.
   */
  #watch(conversation: string): void {
    if (this.#watches.has(conversation)) return;
    this.#unwatchable.delete(conversation);
    const session = this.session(conversation);
    const watching: Watching = {
      watch: new ScreenWatch(),
      inflight: false,
      failures: 0,
      timer: this.#pulseMs <= 0 ? undefined : setInterval(() => {
        if (watching.inflight || session.busy) return;
        watching.inflight = true;
        session.request("pulse").then((value) => {
          const sample = sampleFrom(value, Date.now());
          if (sample === undefined) throw new ComputerError("internal", { message: "The driver answered a pulse without a pointer." });
          watching.failures = 0;
          if (isRecord(value) && value["stop"] === true) this.#personStop();
          if (this.#watches.get(conversation) !== watching) return;
          if (watching.watch.sample(sample)) this.desktop.noteHumanInput();
        }).catch(() => {
          watching.failures += 1;
          if (watching.failures < PULSE_FAILURES) return;
          this.#unwatch(conversation);
          this.#unwatchable.add(conversation);
        }).finally(() => { watching.inflight = false; });
      }, this.#pulseMs),
    };
    watching.timer?.unref();
    this.#watches.set(conversation, watching);
  }

  #unwatch(conversation: string): void {
    const watching = this.#watches.get(conversation);
    if (watching === undefined) return;
    clearInterval(watching.timer);
    this.#watches.delete(conversation);
  }

  /**
   * A picture of the display the person is pointing at, taken as they finish
   * speaking so it is ready when the turn starts. Skipped when the shared
   * picture already shows that display and nothing has happened since. It is
   * taken under its own actor, so it is the conversation's shared picture
   * but never counts as the voice agent's own look before input.
   */
  async #glance(conversation: string): Promise<Record<string, unknown>> {
    if (!this.#sharing.has(conversation)) return { glanced: false, reason: "sharing_off" };
    const now = Date.now();
    const watch = this.#watches.get(conversation)?.watch;
    const pointer = watch?.pointer;
    const latest = this.#sessions.get(conversation)?.latestObservation;
    const happened = latest !== undefined && (watch?.recent(now) ?? []).some((event) => event.kind !== "rest" && event.at > latest.capturedAt);
    const current = latest !== undefined && staleReasons(latest, this.desktop.changes, now).length === 0 && !happened
      && (pointer === undefined || pointer.display === latest.display);
    if (current) return { glanced: false, reason: "current", id: latest.id };
    const meta = { "studio/conversation": conversation, "studio/actor": `glance:${conversation}`, "studio/role": "voice", "studio/sharing": "on" };
    const answer = await this.call("studio_computer_screenshot", pointer === undefined ? {} : { display: pointer.display }, meta);
    const taken = this.#sessions.get(conversation)?.latestObservation;
    return answer.isError === true || taken === undefined || taken === latest
      ? { glanced: false, reason: "failed" }
      : { glanced: true, id: taken.id };
  }

  /**
   * What the person drew, from Studio's own drawing window: shapes in the
   * desktop's physical pixels, placed here on the display they fall on. The
   * ink itself stays on screen, so the next picture shows it too.
   */
  async #drew(conversation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const watch = this.#watches.get(conversation)?.watch;
    if (watch === undefined) return { recorded: 0, reason: "not_watching" };
    const shapes = Array.isArray(input["shapes"]) ? input["shapes"].slice(0, MAX_DRAWN) : [];
    const displays = displaysFrom(await this.session(conversation).request("displays"));
    const now = Date.now();
    let recorded = 0;
    for (const shape of shapes) {
      if (!isRecord(shape) || !isShape(shape["shape"])) continue;
      const [x, y, width, height] = [shape["x"], shape["y"], shape["width"], shape["height"]].map((value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value) : NaN);
      if (x === undefined || y === undefined || width === undefined || height === undefined || [x, y, width, height].some(Number.isNaN)) continue;
      const centreX = x + width / 2; const centreY = y + height / 2;
      const on = displays.find((d) => centreX >= d.x && centreX < d.x + d.width && centreY >= d.y && centreY < d.y + d.height);
      if (on === undefined) continue;
      watch.drew(now, { shape: shape["shape"], display: on.index, x: x - on.x, y: y - on.y, width: Math.max(0, width), height: Math.max(0, height) });
      recorded += 1;
    }
    // Drawing is the person changing what the screen shows.
    if (recorded > 0) this.desktop.noteHumanInput();
    return { recorded };
  }

  /**
   * A bounded snapshot of what the conversation's own agent should know
   * before it decides anything: sharing, the lease, and the latest picture's
   * provenance and freshness - never its bytes. A snapshot, not a promise:
   * the tool boundary checks again when anything is admitted.
   */
  context(conversation: string): Record<string, unknown> {
    const asking = conversationActor(conversation);
    const latest = this.#sessions.get(conversation)?.latestObservation;
    const now = Date.now();
    const watch = this.#watches.get(conversation)?.watch;
    const pointer = watch?.pointer;
    return {
      sharing: this.#sharing.has(conversation),
      live: watch !== undefined ? "on" : this.#unwatchable.has(conversation) ? "unavailable" : "off",
      ...(pointer === undefined ? {} : { pointer: { x: pointer.x, y: pointer.y, display: pointer.display, ageMs: now - pointer.at } }),
      ...(watch === undefined ? {} : { recent: watch.recent(now) }),
      desktop: this.desktop.state(asking),
      ...(latest === undefined ? {} : { latest: {
        id: latest.id, ageMs: now - latest.capturedAt,
        by: latest.by.role === "worker" ? { role: "worker", taskId: latest.by.id, ...(latest.by.name === undefined ? {} : { name: latest.by.name }) }
          : latest.by.id.startsWith("glance:") ? { role: "glance" } : { role: latest.by.role },
        display: latest.display, frame: latest.frame, region: latest.region, image: latest.image, pointer: latest.pointer,
        front: latest.front === null ? null : { handle: latest.front.handle, app: latest.front.app, title: latest.front.title },
        stale: staleReasons(latest, this.desktop.changes, now),
      } }),
    };
  }

  /**
   * The person's controls, from Studio's own UI through the private
   * `studio/computer` method. Never offered to a model: pause, resume and
   * show-me are the person's, and a model only reaches them by the person's
   * own words through the harness.
   */
  async control(params: Record<string, unknown>): Promise<unknown> {
    const input = isRecord(params["input"]) ? params["input"] : {};
    if (input["action"] === "activity") return this.desktop.activity();
    const conversation = conversationKey(params["_meta"]);
    const action = input["action"];
    const asking = conversationActor(conversation);
    switch (action) {
      case "state":
        return { desktop: this.desktop.state(asking), running: this.#sessions.get(conversation)?.running === true };
      case "pause":
      case "demonstrate": {
        const owner = this.desktop.ownerSession;
        const inFlight = owner?.busy === true;
        const result = action === "pause" ? this.desktop.pause(conversation) : this.desktop.demonstrate(conversation);
        const released = result === "other_conversation" ? "not_running" : await this.#releaseHeld(owner);
        return { result, heldInput: released, inFlightUncertain: inFlight, desktop: this.desktop.state(asking) };
      }
      case "resume":
        return { result: this.desktop.resume(conversation), desktop: this.desktop.state(asking) };
      case "sharing":
        this.setSharing(conversation, input["on"] === true);
        return { sharing: this.#sharing.has(conversation) };
      case "context":
        return this.context(conversation);
      case "checkpoint": {
        const id = input["actor"];
        if (typeof id !== "string" || id === "") throw new ComputerError("bad_input", { message: "Name the actor a correction is for." });
        return { held: this.desktop.checkpoint({ conversation, id }) };
      }
      case "glance":
        return this.#glance(conversation);
      case "drew":
        return this.#drew(conversation, input);
      case "release_actor": {
        const id = input["actor"];
        if (typeof id !== "string" || id === "") throw new ComputerError("bad_input", { message: "Name the actor to release." });
        const owner = this.desktop.ownerSession;
        const released = this.desktop.release({ conversation, id });
        return { released, heldInput: released ? await this.#releaseHeld(owner) : "not_running" };
      }
      default:
        throw new ComputerError("bad_input", { message: "Unknown desktop control." });
    }
  }

  /**
   * Lets go of what Studio holds on the paused owner's driver. Behind an
   * active native call it waits only briefly: the pause has already fenced
   * input, and "pending" is the honest answer while that call settles.
   */
  async #releaseHeld(session: ComputerSession | undefined): Promise<ReleaseOutcome> {
    if (session === undefined || !session.running) return "not_running";
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<ReleaseOutcome>((resolve) => { timer = setTimeout(() => resolve("pending"), RELEASE_WAIT_MS); });
    const done = session.request("release_held").then((): ReleaseOutcome => "released", (): ReleaseOutcome => "failed");
    try { return await Promise.race([done, late]); } finally { clearTimeout(timer); }
  }

  async finish(): Promise<void> {
    for (const conversation of [...this.#watches.keys()]) this.#unwatch(conversation);
    await Promise.all([...this.#sessions.values()].map((session) => session.close()));
  }
}
