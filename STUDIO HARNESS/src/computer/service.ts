import { conversationKey, isRecord } from "../serve/stdio.js";
import { conversationActor, DesktopControl, type Actor, type ActorRole } from "./control.js";
import { ComputerError } from "./errors.js";
import { ComputerSession } from "./session.js";
import { toolByName, type ToolAnswer } from "./tools.js";

/** How long a pause waits for held input to be let go before saying it is still pending. */
const RELEASE_WAIT_MS = 5_000;

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
    // Stop bypasses the queue so cancellation invalidates queued input, and
    // fences the lease first so nothing queued slips in before the driver ends.
    if (name === "studio_computer_stop") {
      this.desktop.stopping(actor.conversation);
      return tool.run(session, args, context);
    }
    // Control waits outside the queue too: a paused worker's wait must not
    // hold up the voice agent's screenshot in the same conversation.
    if (name === "studio_computer_control") return tool.run(session, args, context);
    const ticket = this.desktop.ticket(actor);
    try {
      const answer = await session.runTool(
        () => this.desktop.run(session, name, () => tool.run(session, args, context), actor, args, ticket),
        actorKey(actor),
      );
      if (sawHumanInput(answer)) this.desktop.noteHumanInput();
      return { ...answer, structuredContent: { ...answer.structuredContent, desktop: this.desktop.state(actor) } };
    } catch (error) {
      if (error instanceof ComputerError && error.desktop !== undefined) {
        return { isError: true, content: [{ type: "text", text: error.message }], structuredContent: { desktop: error.desktop } };
      }
      throw error;
    }
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
