import { conversationKey, isRecord } from "../serve/stdio.js";
import { bareTool, conversationActor, DesktopControl, type Actor, type ActorRole } from "./control.js";
import { staleReasons } from "./observations.js";
import { VOICE_BATCH_STEPS, VOICE_COMPUTER_TOOLS } from "../contracts/voice-computer.js";
import { ComputerError } from "./errors.js";
import { ComputerSession } from "./session.js";
import { toolByName, type ToolAnswer } from "./tools.js";

/** How long a pause waits for held input to be let go before saying it is still pending. */
const RELEASE_WAIT_MS = 5_000;

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
  readonly desktop = new DesktopControl();
  readonly #create: (key: string) => ComputerSession;

  constructor(create: (key: string) => ComputerSession = (key) => new ComputerSession(key)) {
    this.#create = create;
  }

  session(conversation: string): ComputerSession {
    const existing = this.#sessions.get(conversation);
    if (existing !== undefined) return existing;
    const created = this.#create(conversation);
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
    try {
      const answer = await session.runTool(
        () => this.desktop.run(session, name, () => tool.run(session, args, context), actor, args, ticket),
        actorKey(actor),
      );
      this.#commit(session, actor, sharedAt);
      if (sawHumanInput(answer)) this.desktop.noteHumanInput();
      return this.#withinSharing(actor, sharedAt, { ...answer, structuredContent: { ...answer.structuredContent, desktop: this.desktop.state(actor) } });
    } catch (error) {
      this.#commit(session, actor, sharedAt);
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

  /** The call's picture becomes the conversation's shared observation, with who took it. */
  #commit(session: ComputerSession, actor: Actor, sharedAt: number): void {
    const offered = session.takeOffered();
    if (offered === undefined) return;
    if (actor.role === "voice" && this.#sharingEpoch(actor.conversation) !== sharedAt) return;
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
    return {
      sharing: this.#sharing.has(conversation),
      desktop: this.desktop.state(asking),
      ...(latest === undefined ? {} : { latest: {
        id: latest.id, ageMs: now - latest.capturedAt, by: latest.by.role === "worker" ? { role: "worker", taskId: latest.by.id, ...(latest.by.name === undefined ? {} : { name: latest.by.name }) } : { role: latest.by.role },
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
    await Promise.all([...this.#sessions.values()].map((session) => session.close()));
  }
}
