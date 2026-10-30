import { AsyncLocalStorage } from "node:async_hooks";
import { isRecord } from "../serve/stdio.js";
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
 * A coordinate is read off a picture, so a coordinate call names the frame
 * it was read from (`frameId`), and the frame - not a bare "have you looked"
 * - is what admits it: one the caller was given, taken at the current change
 * count, of the display the point is on. A status call is still a look for
 * keys and references; it is never a frame, because it shows no pixels.
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
  | "revoked"
  | "frame_required"
  | "frame_unknown"
  | "frame_stale"
  | "frame_display"
  | "escape";

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

/** Tools whose point is read off a picture, so they name the frame it came from. */
const FRAME_TOOLS = new Set(["move", "click", "drag", "mouse_button", "scroll"]);

/** How many frames the lease remembers across all actors; an older one is refused as unknown. */
const MAX_FRAMES = 32;

/** How many actors' turns the lease remembers; a forgotten actor's next call starts a turn. */
const MAX_TURNS = 64;

/** The bare tool name a call or a batch step uses. */
export function bareTool(name: string): string {
  return name.replace(/^studio_computer_/, "");
}

/**
 * Letting go of a held button or key: how input stops, so it never waits for
 * a look or a frame, including while Stop is recovering a failed driver.
 */
function isRelease(bare: string, args: Record<string, unknown>): boolean {
  return (bare === "mouse_button" || bare === "hold_key") && args["action"] === "up";
}

/**
 * Whether a call's coordinates must be bound to a frame. A release is never
 * bound, and a scroll by element reference names no point.
 */
function needsFrame(bare: string, args: Record<string, unknown>): boolean {
  if (!FRAME_TOOLS.has(bare) || isRelease(bare, args)) return false;
  return !(bare === "scroll" && args["ref"] !== undefined && args["x"] === undefined);
}

/**
 * A batch step's arguments with the batch's frame, when the step is a
 * coordinate step that names none of its own. The one rule both the lease
 * (which admits the batch) and the batch (which runs the step) apply.
 */
export function withBatchFrame(step: string, args: Record<string, unknown>, frameId: unknown): Record<string, unknown> {
  if (!needsFrame(bareTool(step), args) || args["frameId"] !== undefined || typeof frameId !== "string") return args;
  return { ...args, frameId };
}

/** A frame a coordinate call depends on, and the display it names for the point. */
interface FrameUse {
  readonly frameId: unknown;
  readonly display: unknown;
}

/** The frames a call's coordinates depend on: its own, or every coordinate step's in a batch. */
export function frameUses(name: string, args: Record<string, unknown>): readonly FrameUse[] {
  const bare = bareTool(name);
  if (bare !== "batch") return needsFrame(bare, args) ? [{ frameId: args["frameId"], display: args["display"] }] : [];
  const steps: unknown[] = Array.isArray(args["steps"]) ? args["steps"] : [];
  return steps.flatMap((step): FrameUse[] => {
    if (!isRecord(step) || typeof step["tool"] !== "string") return [];
    const bound = withBatchFrame(step["tool"], step, args["frameId"]);
    return needsFrame(step["tool"], bound) ? [{ frameId: bound["frameId"], display: bound["display"] }] : [];
  });
}

/** A frame as the call that took it records it: its id, the displays it shows, and the change count its pixels were taken at. */
export interface FrameRecord {
  readonly id: string;
  readonly displays: readonly number[];
  readonly changes: number;
}

/** The change count of the admitted call running now, read by `captureChanges`. */
const capture = new AsyncLocalStorage<() => number>();

/**
 * The desktop's change count now, for a call about to capture a frame;
 * undefined outside an admitted call. Sampled before the pixels, so anything
 * that happens while they are taken leaves the frame stale rather than fresh.
 */
export function captureChanges(): number | undefined {
  return capture.getStore()?.();
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
  readonly #frames = new Map<string, { readonly key: string; readonly displays: readonly number[]; readonly changes: number }>();
  readonly #revoked = new Map<string, number>();
  readonly #turns = new Map<string, string>();
  /** Why the desktop is paused: the person's control, or their held Escape. */
  #pausedBy: "control" | "escape" = "control";
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
      return capture.run(() => this.#changes, operation).then((result) => {
        if (LOOKS.has(name) && lookedAt === this.#changes) this.#seen.set(key, this.#changes);
        return result;
      });
    }
    const refusal = this.#admit(session, actor, ticket, name, args);
    if (refusal !== undefined) return Promise.reject(this.#refusalError(actor, refusal));
    const generation = this.#generation;
    // Letting go is cleanup and must not wait for a look.
    const cleanup = isRelease(name, args);
    if (name !== "read_ui" && name !== "wait_for_window" && !cleanup) this.#input(key);
    const guard: Guard = {
      check: () => {
        if (this.#generation === generation && this.#owner?.actor !== undefined && keyOf(this.#owner.actor) === key) return undefined;
        if (this.stoppedByPerson) return refusalMessage({ ...this.state(actor), refused: "escape" });
        return "Desktop control changed during this call: it was paused, stopped or handed over, or a correction from the person arrived. The steps after this point were not sent. Get status and look at the screen before deciding anything; do not replay them automatically.";
      },
    };
    return guards.run(guard, async () => {
      const result = await capture.run(() => this.#changes, operation);
      if (name === "read_ui" && this.#generation === generation) this.#seen.set(key, this.#changes);
      return result;
    });
  }

  #admit(session: ComputerSession, actor: Actor, ticket: Ticket, name: string, args: Record<string, unknown>): ControlRefusal | undefined {
    const refusal = this.#check(actor, ticket, name, args);
    if (refusal === undefined && this.#owner === undefined) {
      this.#owner = { actor, session };
      this.#generation++;
      this.#notify();
    }
    return refusal;
  }

  /**
   * What admitting this call now would answer, without taking the desktop
   * or counting anything. For a check that must run first and only for a
   * call that would be admitted - the person is not asked about input the
   * lease would refuse anyway.
   */
  wouldRefuse(actor: Actor, tool: string, args: Record<string, unknown>, ticket: Ticket): ControlRefusal | undefined {
    const name = bareTool(tool);
    return OWNER_TOOLS.has(name) ? this.#check(actor, ticket, name, args) : undefined;
  }

  #check(actor: Actor, ticket: Ticket, name: string, args: Record<string, unknown>): ControlRefusal | undefined {
    this.#settleOwner();
    const key = keyOf(actor);
    const revokedAt = this.#revoked.get(key);
    if (revokedAt !== undefined && revokedAt > ticket.queuedAt) return "revoked";
    const owner = this.#owner;
    if (owner !== undefined && owner.session.releasing && owner.actor.conversation !== actor.conversation) return "other_conversation";
    if (owner !== undefined && owner.session.releasing) return "stopping";
    if (this.#mode === "paused") return this.#pausedBy === "escape" ? "escape" : "paused";
    if (this.#mode === "demonstrating") return "demonstrating";
    if (owner !== undefined && keyOf(owner.actor) !== key) {
      return owner.actor.conversation === actor.conversation ? "not_owner" : "other_conversation";
    }
    const cleanup = isRelease(name, args);
    if (!NEEDS_NO_LOOK.has(name) && !cleanup) {
      // A valid frame is a look at the current screen. Without one, a stale
      // look is named first, because looking again is what fixes both.
      const uses = frameUses(name, args);
      const framed = uses.length === 0 ? undefined : this.#frameRefusal(key, uses);
      if ((uses.length === 0 || framed !== undefined) && this.#seen.get(key) !== this.#changes) return "observe_first";
      if (framed !== undefined) return framed;
    }
    return undefined;
  }

  /**
   * A call from this actor in the named turn (the harness's submission id,
   * never a model's word). A new turn ends what the last one could rely on:
   * its looks and its frames, so the first input of a turn follows a look
   * taken in it. Answers whether a turn began, so the caller can let go of
   * the driver's element references too. No turn named changes nothing.
   */
  beginTurn(actor: ActorIdentity, turn: string | undefined): boolean {
    if (turn === undefined || turn === "") return false;
    const key = keyOf(actor);
    if (this.#turns.get(key) === turn) return false;
    this.#turns.delete(key);
    this.#turns.set(key, turn);
    while (this.#turns.size > MAX_TURNS) this.#turns.delete(this.#turns.keys().next().value ?? "");
    this.#seen.delete(key);
    for (const [id, frame] of this.#frames) if (frame.key === key) this.#frames.delete(id);
    return true;
  }

  #frameRefusal(key: string, uses: readonly FrameUse[]): ControlRefusal | undefined {
    for (const use of uses) {
      if (typeof use.frameId !== "string" || use.frameId === "") return "frame_required";
      const frame = this.#frames.get(use.frameId);
      if (frame === undefined || frame.key !== key) return "frame_unknown";
      if (frame.changes !== this.#changes) return "frame_stale";
      const display = typeof use.display === "number" ? use.display : undefined;
      if (display === undefined ? frame.displays.length !== 1 : !frame.displays.includes(display)) return "frame_display";
    }
    return undefined;
  }

  /**
   * A frame this actor was given. Only the actor's own: a picture another
   * actor took is evidence it may read (`control latest`), never a frame its
   * coordinates may claim.
   */
  recordFrame(actor: ActorIdentity, frame: FrameRecord): void {
    this.#frames.delete(frame.id);
    this.#frames.set(frame.id, { key: keyOf(actor), displays: [...new Set(frame.displays)], changes: frame.changes });
    while (this.#frames.size > MAX_FRAMES) this.#frames.delete(this.#frames.keys().next().value ?? "");
  }

  /** The displays one of this actor's frames shows, so a point that names no display lands on the frame's. */
  frameDisplays(actor: ActorIdentity, id: string): readonly number[] | undefined {
    const frame = this.#frames.get(id);
    return frame === undefined || frame.key !== keyOf(actor) ? undefined : frame.displays;
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

  /** How many times the screen may have changed; a shared picture records it to judge staleness. */
  get changes(): number {
    return this.#changes;
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
    this.#pausedBy = "control";
    this.#fenceAll();
    return "paused";
  }

  /**
   * The person held Escape while Studio acted (P1-6): a deliberate stop, not
   * a touch. It pauses the desktop for everyone whatever chat holds it, since
   * the key is on the one physical keyboard, and every step still queued is
   * refused. Only the person resumes it. A touch stays what it was: the
   * screen is stale and work continues after a look.
   */
  personStop(): "paused" | "already" {
    if (this.#mode === "paused" && this.#pausedBy === "escape") return "already";
    this.#mode = "paused";
    this.#pausedBy = "escape";
    this.#fenceAll();
    return "paused";
  }

  /** Whether the current pause came from the person's held Escape. */
  get stoppedByPerson(): boolean {
    return this.#mode === "paused" && this.#pausedBy === "escape";
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

  /**
   * A correction is on its way to this actor (D4, redirect). It keeps the
   * desktop - nothing was handed over - but the rest of what it already sent
   * is refused at the next step, and it looks again before any new input,
   * so the correction lands at a boundary rather than after a batch that
   * ignored it. Answers whether the actor held the desktop.
   */
  checkpoint(actor: ActorIdentity): boolean {
    const owner = this.#owner;
    if (owner === undefined || keyOf(owner.actor) !== keyOf(actor)) return false;
    this.#generation++;
    this.#changes++;
    this.#revoked.set(keyOf(actor), this.#generation);
    this.#notify();
    return true;
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

  /** Product presence follows the lease, including confirmed driver exit. */
  activity(): { readonly conversationId: string | null; readonly mode: DesktopMode } {
    this.#settleOwner();
    return {
      conversationId: this.#owner?.actor.conversation ?? null,
      mode: this.#owner?.session.releasing === true ? "stopping" : this.#mode,
    };
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
    case "frame_required":
      return "No input was sent: a point must name the frameId of the picture it was read from. Take a screenshot (or read_ui) and give its frameId with the coordinates.";
    case "frame_unknown":
      return "No input was sent: that frameId is not one of your recent pictures, and a picture another actor took does not count. Take a screenshot and use the frameId it gives.";
    case "frame_stale":
      return "No input was sent: the screen may have changed since that frame was taken (input, a control change, or the person's own). Look again and use the new frameId.";
    case "frame_display":
      return "No input was sent: that frame does not show the display the point names. Give the display the frame shows, or take a picture of the display you mean.";
    case "escape":
      return "The person held Escape to stop computer use. No input was sent from here on. Stop and report what was done; when they resume, look at the screen again before any input, and never replay what was stopped.";
    default:
      return "Desktop control refused this input. No input was sent.";
  }
}
