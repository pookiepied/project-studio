import { ExtendError } from "./errors.js";
import { EXTENSION_KINDS, type ExtensionInventory, type ExtensionKind } from "./inventory.js";

/**
 * Making what is running match what the user chose.
 *
 * The design is decided in `tasks/003-phase-11-work-plan.md` section 003.3a and
 * is implemented as written: the desired set is computed from SQLite, compared
 * against what is live, and the difference is applied. There is no event bus,
 * no observable, and no subscription anywhere in this harness, and this is the
 * mechanism that means there does not need to be.
 *
 * **Why not events.** An event system is fragile in exactly one direction and it
 * is the bad one. Miss a notification — a crash between the write and the
 * notify, a listener registered a moment late, a row changed by a migration —
 * and the live state is wrong permanently, with nothing that will ever correct
 * it. Recomputing from the truth costs one cycle of staleness instead.
 *
 * **It never learns what a kind is.** Same rule as the spine it belongs to, and
 * the same architecture test enforces it. A kind registers a function that
 * takes a list of ids and makes itself match; nothing about MCP, skills, or
 * hooks appears here. A fourth kind adds a folder and edits nothing.
 *
 * **The delay is not a cost.** A change is applied at the next pass rather than
 * instantly, and the design already required that for a different reason: what
 * a model is told it can do is part of a cached prefix, so it may only change
 * at a turn boundary anyway.
 */

/**
 * What a kind does to make itself match.
 *
 * It receives the ids that should be live and nothing else — not the titles,
 * not who wrote them, and not what they are. Everything else it needs it
 * already has, because it is the thing that installed them.
 *
 * The design named this `(desired, live) => Promise<void>`. It takes only
 * `desired`, because `live` is the one thing the spine must not hold: a running
 * process belongs to whatever started it, and a spine that carried live objects
 * would know what a kind is by definition. The difference is still computed
 * against a plain set and still tested without a process — that is
 * `planReconcile`, below.
 */
export type KindReconciler = (desired: readonly string[]) => Promise<void>;

export interface ReconcilePlan {
  /** Wanted and not live. */
  readonly start: readonly string[];
  /** Live and not wanted. */
  readonly stop: readonly string[];
}

/**
 * The difference between what should be running and what is.
 *
 * A pure function over two lists of ids, which is what makes the hard part of
 * reconciling testable without starting anything. Order follows `desired` and
 * then `live`, so a plan is stable and a test can assert one.
 */
export function planReconcile(
  desired: Iterable<string>,
  live: Iterable<string>,
): ReconcilePlan {
  const wanted = new Set(desired);
  const running = new Set(live);

  return {
    start: [...wanted].filter((id) => !running.has(id)),
    stop: [...running].filter((id) => !wanted.has(id)),
  };
}

export class ExtensionReconciler {
  readonly #inventory: ExtensionInventory;
  readonly #reconcilers = new Map<ExtensionKind, KindReconciler>();
  /**
   * Bumped by anything that changes the desired set.
   *
   * The cheap half of the design: a pass that would find nothing to do costs
   * one integer comparison instead of a database read per kind. Starting at one
   * so that the first call always runs — nothing has been reconciled yet, and
   * a counter that began at the settled value would skip the startup pass.
   */
  #generation = 1;
  #settled: { readonly key: string; readonly generation: number } | undefined;
  #inFlight: { readonly key: string; readonly pass: Promise<boolean> } | undefined;

  constructor(inventory: ExtensionInventory) {
    this.#inventory = inventory;
  }

  /**
   * A kind says how to make itself match.
   *
   * One per kind, and a second is refused rather than replacing the first —
   * the same rule as the inventory's providers, for the same reason. Two
   * reconcilers for one kind would fight, and the one that lost would appear to
   * work.
   */
  register(kind: ExtensionKind, run: KindReconciler): void {
    if (this.#reconcilers.has(kind)) {
      throw new ExtendError("internal", {
        message: `Extensions of kind "${kind}" are already reconciled by something else.`,
      });
    }
    this.#reconcilers.set(kind, run);
  }

  unregister(kind: ExtensionKind): boolean {
    return this.#reconcilers.delete(kind);
  }

  /**
   * Something changed the desired set.
   *
   * Called after installing, removing, or switching something on or off. It is
   * deliberately not a subscription: this says "recompute next time", not
   * "apply this change", so missing one call costs a stale cycle rather than a
   * permanent lie. Missing an event in the other design costs the lie.
   */
  changed(): void {
    this.#generation += 1;
  }

  /**
   * Brings the live set into line with what the open projects chose.
   *
   * Returns whether a pass actually ran. Safe to call at startup, at a turn
   * boundary, on a timer, and after a crash — the same implementation covers
   * all four, which is the whole argument for reconciling rather than
   * reacting.
   *
   * **It takes every open project, not one.** Switching something off in a
   * project is a decision about what that project *sees*, and the spine already
   * enforces that by listing only what a project switched on. It was never a
   * decision to end a process. Passing one project's answer as the whole truth
   * is what made a server switched on in one project and off in another into
   * one process being asked for opposite things — see `C-18`.
   *
   * So the desired set is the union across open projects. Something runs while
   * at least one project wants it, and stops when none do. That is reference
   * counting, written as a set so there is no count to get wrong.
   *
   * **One pass at a time, harness-wide.** Two concurrent passes would spawn the
   * same server twice. A second call for the same projects joins the one that is
   * running; a call for a different set queues behind it.
   */
  async reconcile(projectIds: readonly string[]): Promise<boolean> {
    const projects = [...new Set(projectIds)].sort();
    // A NUL cannot appear in a project id and cannot be confused with one, so
    // two different sets can never produce the same key.
    const key = projects.join("\0");
    const current = this.#inFlight;

    if (current?.key === key) return current.pass;

    if (
      current === undefined &&
      this.#settled?.key === key &&
      this.#settled.generation === this.#generation
    ) {
      return false;
    }

    // A failed pass must not stop the queued one from running, and its failure
    // belongs to the caller that asked for it rather than to this one.
    const after = current?.pass.then(
      () => undefined,
      () => undefined,
    );
    const pass = (after ?? Promise.resolve()).then(() => this.#pass(projects, key));

    this.#inFlight = { key, pass };
    void pass.then(
      () => this.#finish(pass),
      () => this.#finish(pass),
    );

    return pass;
  }

  #finish(pass: Promise<boolean>): void {
    if (this.#inFlight?.pass === pass) this.#inFlight = undefined;
  }

  async #pass(projects: readonly string[], key: string): Promise<boolean> {
    // Read before any work, not after. A change that arrives while this pass is
    // running is recorded as unhandled, so the next call runs again instead of
    // believing this pass covered it.
    const generation = this.#generation;
    const failures: string[] = [];

    for (const kind of EXTENSION_KINDS) {
      const run = this.#reconcilers.get(kind);
      if (run === undefined) continue;

      // The union, deduplicated. A `Set` rather than a count: two projects
      // wanting the same thing is one thing running, and a count that drifted
      // would either leak a process or end one somebody was using.
      const desired = new Set<string>();
      for (const projectId of projects) {
        for (const entry of this.#inventory.active(kind, projectId)) desired.add(entry.id);
      }

      try {
        await run([...desired]);
      } catch (error) {
        // Every kind is attempted. One kind failing must not decide anything
        // for the others — a broken hook that stopped MCP from starting would
        // be a failure nobody could diagnose from either side.
        failures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failures.length > 0) {
      // Not settled, so the next call tries again rather than believing the
      // live set matches.
      throw new ExtendError("internal", {
        message: `Some extensions could not be brought into line — ${failures.join("; ")}`,
      });
    }

    this.#settled = { key, generation };
    return true;
  }
}
