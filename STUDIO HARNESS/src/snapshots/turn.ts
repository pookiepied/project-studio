import type { ErrorReporter } from "../observability/error-reporter.js";
import { SnapshotError } from "./errors.js";
import type { Snapshot, SnapshotStore } from "./store.js";
import { observeOperation } from "../observability/operation.js";

/**
 * When a snapshot is taken.
 *
 * Per user turn, lazily, immediately before that turn's first write. Two
 * alternatives were considered and both are worse:
 *
 * - **Per write.** Produces a history nobody can navigate — twenty entries for
 *   one instruction, and no single one of them is "before you asked for this".
 * - **Per turn, eagerly.** Commits on every turn including the ones that only
 *   read, filling the history with points nothing happened at.
 *
 * "Undo what the agent just did" is the unit people actually think in, and a
 * turn is that unit.
 */

export interface SnapshotHook {
  /**
   * Called by the gate before anything with a `write` effect executes.
   *
   * `resource` is the already-resolved path for a filesystem tool, and the
   * command for a tool like git. Both trigger a snapshot; only a path is
   * recorded as touched, since only a path can be force-added.
   */
  beforeWrite(resource: string | undefined, kind: "path" | "command" | "none"): Promise<void>;
}

export interface TurnSnapshotsOptions {
  readonly store: SnapshotStore;
  readonly reporter?: ErrorReporter;
  /**
   * Whether a failed snapshot blocks the write.
   *
   * A function, not a boolean, because the answer changes with the execution
   * mode and the mode changes mid-session. It is read at the moment of the
   * write rather than captured at construction, so switching into Auto
   * takes effect on the next write instead of the next session.
   *
   * While a person approves each write, a snapshot failure is reported and the
   * write proceeds: undo is a safety net rather than the safety story, and
   * refusing to work because the net is unavailable turns a degraded feature
   * into an outage.
   *
   * Under Auto nobody is approving anything, "you can undo it" *is* the
   * safety story, and a write with no snapshot behind it is exactly what that
   * argument rules out. `requiresUndo(mode)` supplies this.
   */
  readonly required?: boolean | (() => boolean);
}

export class TurnSnapshots implements SnapshotHook {
  readonly #store: SnapshotStore;
  readonly #reporter: ErrorReporter | undefined;
  readonly #required: () => boolean;
  /**
   * Zero until the first `beginTurn`, so the first turn is labelled "turn 1".
   *
   * `beginTurn` increments before it labels, so starting at 1 made the first
   * turn "turn 2" for any caller that opened every turn — which is every
   * caller. A history whose numbers do not match the conversation is a history
   * nobody can navigate, which is the one job it has.
   */
  #turn = 0;
  #label = "turn 1";
  /**
   * The snapshot for the current turn, as a promise.
   *
   * Held as the promise rather than a boolean so two tool calls that start
   * concurrently share one capture instead of racing to make two.
   */
  #pending: Promise<Snapshot | undefined> | undefined;

  constructor(options: TurnSnapshotsOptions) {
    this.#store = options.store;
    this.#reporter = options.reporter;
    const required = options.required ?? false;
    this.#required = typeof required === "function" ? required : () => required;
  }

  /**
   * Opens a new turn.
   *
   * Nothing is captured here. The next write triggers it, and a turn with no
   * writes leaves no trace.
   */
  beginTurn(label?: string): void {
    this.#turn += 1;
    this.#label = label ?? `turn ${this.#turn}`;
    this.#pending = undefined;
  }

  async beforeWrite(
    resource: string | undefined,
    kind: "path" | "command" | "none",
  ): Promise<void> {
    // Ordered deliberately: the snapshot must capture the state *before* this
    // write, so the path being written is recorded as touched only afterwards.
    // It is force-added from the following snapshot onward, which is the first
    // one where it exists.
    //
    // If the capture rejects (Auto, `required` true), the rejected promise
    // is cleared so the next write in the same turn can retry. Otherwise the
    // first transient failure (lock, disk full) would poison the whole turn
    // (T-18). When `required` is false the capture resolves to undefined, so
    // this path is not taken.
    if (this.#pending === undefined) {
      this.#pending = this.#capture().catch((error: unknown) => {
        this.#pending = undefined;
        throw error;
      });
    }
    await this.#pending;

    if (kind === "path" && resource !== undefined) {
      this.#store.markTouched(resource);
    }
  }

  async #capture(): Promise<Snapshot | undefined> {
    try {
      return await observeOperation("tool", "snapshot.capture", () => this.#store.capture(this.#label));
    } catch (error) {
      this.#reporter?.report(error, {
        operation: "snapshots.capture",
        ...(error instanceof SnapshotError ? { error_code: error.code } : {}),
      });
      if (this.#required()) throw error;
      return undefined;
    }
  }
}
