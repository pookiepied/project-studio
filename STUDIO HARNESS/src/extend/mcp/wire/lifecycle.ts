/**
 * Connection lifecycle for a single MCP server.
 *
 * The design is decided in `tasks/003-phase-11-work-plan.md` section 003.3a and
 * is implemented exactly there. One server has genuinely illegal transitions —
 * `ready` cannot follow `stopping`, `starting` cannot be entered twice — and
 * those are the bugs that leave two processes running for one server.
 *
 * ```
 * idle -> starting -> ready -> stopping -> idle
 *           |           |
 *           v           v
 *         failed <------+     (with backoff, and a give-up state)
 * ```
 *
 * No timers, no processes, no I/O. This is a function and a type. The `failed`
 * state carries the attempt count so the caller can ask `backoff.ts` what to do
 * next; it does not import that module and holds only a number. A `given-up`
 * state is terminal and nothing leaves it except an explicit restart.
 */

export type LifecycleState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly attempts: number }
  | { readonly kind: "ready" }
  | { readonly kind: "stopping" }
  | { readonly kind: "failed"; readonly attempts: number }
  | { readonly kind: "given-up" };

export type LifecycleEvent =
  | { readonly kind: "start" }
  | { readonly kind: "started" }
  | { readonly kind: "stop" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed" }
  | { readonly kind: "giveUp" }
  | { readonly kind: "restart" };

export type TransitionResult =
  | { readonly ok: true; readonly state: LifecycleState }
  | { readonly ok: false; readonly reason: string };

/**
 * One transition function: state plus event gives the next state.
 *
 * An illegal transition is refused, not ignored, and the refusal is a returned
 * result, not a thrown error — the caller decides whether an illegal
 * transition is a crash or a logged mistake.
 */
export function transition(
  state: LifecycleState,
  event: LifecycleEvent,
): TransitionResult {
  switch (state.kind) {
    case "idle": {
      if (event.kind === "start") {
        return { ok: true, state: { kind: "starting", attempts: 0 } };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }

    case "starting": {
      if (event.kind === "started") {
        return { ok: true, state: { kind: "ready" } };
      }
      if (event.kind === "failed") {
        return {
          ok: true,
          state: { kind: "failed", attempts: state.attempts + 1 },
        };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }

    case "ready": {
      if (event.kind === "stop") {
        return { ok: true, state: { kind: "stopping" } };
      }
      if (event.kind === "failed") {
        return { ok: true, state: { kind: "failed", attempts: 1 } };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }

    case "stopping": {
      if (event.kind === "stopped") {
        return { ok: true, state: { kind: "idle" } };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }

    case "failed": {
      if (event.kind === "start") {
        return {
          ok: true,
          state: { kind: "starting", attempts: state.attempts },
        };
      }
      if (event.kind === "giveUp") {
        return { ok: true, state: { kind: "given-up" } };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }

    case "given-up": {
      if (event.kind === "restart") {
        return { ok: true, state: { kind: "idle" } };
      }
      return {
        ok: false,
        reason: `Cannot ${event.kind} from ${state.kind}.`,
      };
    }
  }
}
