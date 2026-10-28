import { AsyncLocalStorage } from "node:async_hooks";
import { ComputerError } from "./errors.js";
import type { ComputerSession } from "./session.js";

/**
 * Who may move the one mouse and press the one keyboard, and when.
 *
 * One desktop, many hands that could reach for it: the conversation's own
 * agent (typed or spoken), each voice task's worker, and the delegates those
 * run. A conversation is not enough to tell them apart - a worker and the
 * voice agent of the same chat share one driver - so the lease names the
 * actor too: the agent instance making the call, which a delegate shares
 * with whoever started it (ADR 0058 §3). The harness stamps it into `_meta`
 * from its own execution context; a model never spells it.
 *
 * The lease is coordination, never permission. Every call still passes the
 * kernel under the caller's own scope before it gets here, and holding the
 * desktop grants nothing the kernel did not.
 *
 * Three numbers keep the rules honest without anybody's word for it:
 *
 * - **generation** - one ownership interval. It moves whenever the owner or
 *   the mode changes, and a call admitted under an older one is refused at
 *   its next driver request, so a batch stops between steps when control is
 *   handed over, paused or stopped.
 * - **revocations** - the generation at which an actor last lost the desktop.
 *   A call that actor queued before then is refused even if it has the
 *   desktop again by the time the call starts: a stale continuation is not
 *   made current by its author coming back.
 * - **changes** - how many times the screen may have changed under someone:
 *   any actor's input, any mode change, the person's own clicks and keys. An
 *   actor whose last look predates the latest change must look again before
 *   it sends input. Its own input does not count against it.
 *
 * Scope: this is one computer MCP process. It does not exclude independent
 * programs, a second harness, or the person - and it does not try to.
 */

export type ActorRole = "conversation" | "voice" | "worker";

export interface Actor {
  readonly conversation: string;
  /** The agent instance: the conversation id for its own agent, the task id for a worker. */
  readonly id: string;
  readonly role: ActorRole;
  /** A worker's spoken name, for telling a sibling who holds the desktop. */
  readonly name?: string | undefined;
}

export type DesktopMode = "active" | "paused" | "demonstrating" | "stopping";

export type ControlRefusal =
  | "other_conversation"
  | "not_owner"
  | "paused"
  | "demonstrating"
  | "stopping"
  | "observe_first"
  | "revoked";

/** What one actor is told about the desktop. Another chat is only ever "another chat". */
export interface DesktopState {
  readonly mode: DesktopMode;
  readonly generation: number;
  readonly owner:
    | null
    | { readonly self: true }
    | { readonly self: false; readonly sameConversation: false }
    | { readonly self: false; readonly sameConversation: true; readonly role: ActorRole; readonly taskId?: string; readonly name?: string };
  /** Whether this actor has looked since the screen last may have changed. */
  readonly fresh: boolean;
  readonly refused?: ControlRefusal;
}

/** Tools that change desktop state, or the driver's working window and its refs. */
const OWNER_TOOLS = new Set([
  "batch", "move", "click", "drag", "mouse_button", "scroll", "type", "key", "hold_key",
  "open", "focus", "arrange", "act", "set_value", "select_text", "read_ui", "clipboard",
  "wait_for_window",
]);

/** Owner-only, but a look rather than an action: no fresh look is needed first. */
const NEEDS_NO_LOOK = new Set(["read_ui", "wait_for_window"]);

/** Answers that are a fresh look at the screen, clearing an actor's staleness. */
const LOOKS = new Set(["screenshot", "zoom", "status", "read_ui", "wait"]);

/** The bare tool name a call or a batch step uses. */
export function bareTool(name: string): string {
  return name.replace(/^studio_computer_/, "");
}

export function isOwnerTool(name: string): boolean {
  return OWNER_TOOLS.has(bareTool(name));
}

/** The actor a call without Studio's own `_meta` is: its conversation, as before. */
export function conversationActor(conversation: string): Actor {
  return { conversation, id: conversation, role: "conversation" };
}

/** An actor as the lease keys it: its conversation and instance, never its role or name. */
type ActorIdentity = Pick<Actor, "conversation" | "id">;

function keyOf(actor: ActorIdentity): string {
  return `${actor.conversation}\u0000${actor.id}`;
}

interface Ticket {
  readonly key: string;
  /** The generation when the call was queued. */
  readonly queuedAt: number;
}

interface Guard {
  readonly check: () => string | undefined;
}

/** The running call's lease check, read by the session before each driver request. */
const guards = new AsyncLocalStorage<Guard>();

/**
 * Refuses a driver request whose call no longer holds the desktop. Called by
 * the session for every request, so the batch's later steps stop when the
 * lease moves rather than at the batch's end.
 */
export function checkDesktopGuard(): void {
  const refusal = guards.getStore()?.check();
  if (refusal !== undefined) throw new ComputerError("control", { message: refusal });
}

export class DesktopControl {
  #owner: { readonly actor: Actor; readonly session: ComputerSession } | undefined;
  /** The mode the person set. "stopping" is derived from the owner's driver, never stored. */
  #mode: "active" | "paused" | "demonstrating" = "active";
  #generation = 0;
  #changes = 0;
  readonly #seen = new Map<string, number>();
  readonly #revoked = new Map<string, number>();
  readonly #listeners = new Set<() => void>();

  /**
   * Taken when a call is queued, so a later revocation fences it. A loss
   * that already happened (the owner's driver closed) is recorded first, or a
   * call made after it would read as queued before it.
   */
  ticket(actor: Actor): Ticket {
    this.#settleOwner();
    return { key: keyOf(actor), queuedAt: this.#generation };
  }

  /**
   * Admits one tool call and runs it. Observation tools are admitted for any
   * actor and wait for nobody else's conversation. Owner tools take the
   * desktop when it is free, are refused - never queued for later - when it
   * is not, and carry a guard that every driver request rechecks.
   */
  run<T>(
    session: ComputerSession,
    tool: string,
    operation: () => Promise<T>,
    actor: Actor = conversationActor(session.key),
    args: Record<string, unknown> = {},
    ticket: Ticket = this.ticket(actor),
  ): Promise<T> {
    const name = bareTool(tool);
    const key = keyOf(actor);
    if (!OWNER_TOOLS.has(name)) {
      const lookedAt = this.#changes;
      return operation().then((result) => {
        if (LOOKS.has(name) && lookedAt === this.#changes) this.#seen.set(key, this.#changes);
        return result;
      });
    }
    const refusal = this.#admit(session, actor, ticket, name, args);
    if (refusal !== undefined) return Promise.reject(this.#refusalError(actor, refusal));
    const generation = this.#generation;
    // Releasing a held button is cleanup and must not wait for a look.
    const cleanup = name === "mouse_button" && args["action"] === "up";
    if (name !== "read_ui" && name !== "wait_for_window" && !cleanup) this.#input(key);
    const guard: Guard = {
      check: () => {
        if (this.#generation === generation && this.#owner?.actor !== undefined && keyOf(this.#owner.actor) === key) return undefined;
        return "Desktop control changed during this call: it was paused, stopped or handed over. The steps after this point were not sent. Get status and look at the screen before deciding anything; do not replay them automatically.";
      },
    };
    return guards.run(guard, async () => {
      const result = await operation();
      if (name === "read_ui" && this.#generation === generation) this.#seen.set(key, this.#changes);
      return result;
    });
  }

  #admit(session: ComputerSession, actor: Actor, ticket: Ticket, name: string, args: Record<string, unknown>): ControlRefusal | undefined {
    this.#settleOwner();
    const key = keyOf(actor);
    const revokedAt = this.#revoked.get(key);
    if (revokedAt !== undefined && revokedAt > ticket.queuedAt) return "revoked";
    const owner = this.#owner;
    if (owner !== undefined && owner.session.releasing && owner.actor.conversation !== actor.conversation) return "other_conversation";
    if (owner !== undefined && owner.session.releasing) return "stopping";
    if (this.#mode === "paused") return "paused";
    if (this.#mode === "demonstrating") return "demonstrating";
    if (owner !== undefined && keyOf(owner.actor) !== key) {
      return owner.actor.conversation === actor.conversation ? "not_owner" : "other_conversation";
    }
    const cleanup = name === "mouse_button" && args["action"] === "up";
    if (!NEEDS_NO_LOOK.has(name) && !cleanup && this.#seen.get(key) !== this.#changes) return "observe_first";
    if (owner === undefined) {
      this.#owner = { actor, session };
      this.#generation++;
      this.#notify();
    }
    return undefined;
  }

  /** The screen may have changed because of this actor's input: others must look again. */
  #input(key: string): void {
    const wasFresh = this.#seen.get(key) === this.#changes;
    this.#changes++;
    if (wasFresh) this.#seen.set(key, this.#changes);
  }

  /** An owner whose driver has ended - idle close, crash, or a confirmed stop - holds nothing. */
  #settleOwner(): void {
    const owner = this.#owner;
    if (owner === undefined || owner.session.running || owner.session.releasing) return;
    this.#lose(owner.actor);
  }

  #lose(actor: ActorIdentity): void {
    this.#owner = undefined;
    this.#generation++;
    this.#changes++;
    this.#revoked.set(keyOf(actor), this.#generation);
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** The person's own clicks, keys or wheel since the last answer: everyone looks again. */
  noteHumanInput(): void {
    this.#changes++;
    this.#notify();
  }

  /**
   * Takes a free desktop without sending anything. A look taken before still
   * counts unless someone's input or a mode change has happened since.
   */
  acquire(session: ComputerSession, actor: Actor): ControlRefusal | "acquired" | "already" {
    this.#settleOwner();
    if (this.ownerIs(actor) && this.#mode === "active" && !session.releasing) return "already";
    const refusal = this.#admit(session, actor, this.ticket(actor), "read_ui", {});
    return refusal ?? "acquired";
  }

  /** Releases the desktop if this actor holds it. Not a stop: the driver keeps running. */
  release(actor: ActorIdentity): boolean {
    if (this.#owner === undefined || keyOf(this.#owner.actor) !== keyOf(actor)) return false;
    this.#lose(actor);
    return true;
  }

  /**
   * Pauses automation for the person. Only the owner's own conversation may
   * pause it; another chat's work is stopped from that chat, which keeps one
   * chat from steering another's work by accident.
   */
  pause(conversation: string): "paused" | "already" | "other_conversation" {
    const owner = this.#owner;
    if (owner !== undefined && owner.actor.conversation !== conversation) return "other_conversation";
    if (this.#mode === "paused") return "already";
    this.#mode = "paused";
    this.#fenceAll();
    return "paused";
  }

  /** Hands the desktop to the person to show something. Automation is fenced until done. */
  demonstrate(conversation: string): "demonstrating" | "already" | "other_conversation" {
    const owner = this.#owner;
    if (owner !== undefined && owner.actor.conversation !== conversation) return "other_conversation";
    if (this.#mode === "demonstrating") return "already";
    this.#mode = "demonstrating";
    this.#fenceAll();
    return "demonstrating";
  }

  /** Ends a pause or a demonstration. Everyone, the old owner included, looks again first. */
  resume(conversation: string): "resumed" | "not_paused" | "other_conversation" {
    const owner = this.#owner;
    if (owner !== undefined && owner.actor.conversation !== conversation) return "other_conversation";
    if (this.#mode === "active") return "not_paused";
    this.#mode = "active";
    this.#generation++;
    this.#changes++;
    this.#notify();
    return "resumed";
  }

  /**
   * Takes the desktop from a paused owner of the same conversation, for the
   * actor the person is now talking to. Only from a pause: a running worker
   * is never preempted by another model's decision.
   */
  takeOver(session: ComputerSession, actor: Actor): "acquired" | "not_paused" | "other_conversation" | "already" {
    this.#settleOwner();
    const owner = this.#owner;
    if (owner !== undefined && owner.actor.conversation !== actor.conversation) return "other_conversation";
    if (owner !== undefined && keyOf(owner.actor) === keyOf(actor) && this.#mode === "active") return "already";
    if (this.#mode !== "paused") return owner === undefined ? "already" : "not_paused";
    if (owner !== undefined) this.#revoked.set(keyOf(owner.actor), this.#generation + 1);
    this.#owner = { actor, session };
    this.#mode = "active";
    this.#generation++;
    this.#changes++;
    this.#notify();
    return "acquired";
  }

  /** Stop is starting for this conversation: its owner's queued and later calls are fenced. */
  stopping(conversation: string): void {
    const owner = this.#owner;
    if (owner === undefined || owner.actor.conversation !== conversation) return;
    this.#revoked.set(keyOf(owner.actor), this.#generation + 1);
    this.#generation++;
    this.#changes++;
    this.#notify();
  }

  #fenceAll(): void {
    const owner = this.#owner;
    this.#generation++;
    this.#changes++;
    if (owner !== undefined) this.#revoked.set(keyOf(owner.actor), this.#generation);
    this.#notify();
  }

  /** The owner's driver, for releasing held input when the desktop is paused or handed back. */
  get ownerSession(): ComputerSession | undefined {
    return this.#owner?.session;
  }

  ownerIs(actor: Actor): boolean {
    return this.#owner !== undefined && keyOf(this.#owner.actor) === keyOf(actor);
  }

  state(actor: Actor): DesktopState {
    this.#settleOwner();
    const owner = this.#owner;
    const mode: DesktopMode = owner !== undefined && owner.session.releasing ? "stopping" : this.#mode;
    const fresh = this.#seen.get(keyOf(actor)) === this.#changes;
    if (owner === undefined) return { mode, generation: this.#generation, owner: null, fresh };
    if (keyOf(owner.actor) === keyOf(actor)) return { mode, generation: this.#generation, owner: { self: true }, fresh };
    if (owner.actor.conversation !== actor.conversation) {
      return { mode, generation: this.#generation, owner: { self: false, sameConversation: false }, fresh };
    }
    return {
      mode, generation: this.#generation, fresh,
      owner: {
        self: false, sameConversation: true, role: owner.actor.role,
        ...(owner.actor.role === "worker" ? { taskId: owner.actor.id } : {}),
        ...(owner.actor.name === undefined ? {} : { name: owner.actor.name }),
      },
    };
  }

  /**
   * Waits, bounded, until the desktop's mode or owner changes. For a paused
   * worker: one cheap call instead of a model turn spent asking again.
   */
  waitForChange(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#listeners.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      this.#listeners.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  #refusalError(actor: Actor, refusal: ControlRefusal): ComputerError {
    const state = { ...this.state(actor), refused: refusal };
    return new ComputerError("control", { message: refusalMessage(state), desktop: state });
  }
}

/** The sentence a refusal says, for the model and for the person reading over its shoulder. */
export function refusalMessage(state: DesktopState): string {
  const holder = state.owner === null || state.owner.self
    ? "nobody else"
    : !state.owner.sameConversation
      ? "another conversation"
      : state.owner.role === "worker"
        ? `${state.owner.name ?? "a task"}${state.owner.taskId === undefined ? "" : ` (task ${state.owner.taskId})`}`
        : "this conversation's own agent";
  switch (state.refused) {
    case "other_conversation":
      return "Another conversation is using the desktop. Stop computer use there or wait for it to finish, then observe the desktop again. No input was sent.";
    case "not_owner":
      return `${holder} has the desktop, so no input was sent. Looking is still allowed. Coordinate with that task - steer it, ask the person to pause it, or wait - and never send the input through another tool or a delegate instead.`;
    case "paused":
      return "Computer work is paused by the person. No input was sent. Call studio_computer_control with action wait, or stop and report; when it resumes, look at the screen again before any input.";
    case "demonstrating":
      return "The person is showing something on the desktop. No input was sent. Wait (studio_computer_control action wait) and look at the screen again once they are done.";
    case "stopping":
      return "Computer control is stopping and its cleanup is not yet confirmed. No input was sent. Get status once it has stopped; do not repeat an uncertain action.";
    case "observe_first":
      return "No input was sent: the screen may have changed since you last looked (a handoff, a pause, someone else's input, or the person's own). Take a screenshot or get status first, then decide.";
    case "revoked":
      return "This call was queued before you lost the desktop, so it was refused and nothing was sent. Look at the screen again before deciding what to do; never replay it automatically.";
    default:
      return "Desktop control refused this input. No input was sent.";
  }
}
