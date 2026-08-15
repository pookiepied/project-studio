import type { KindReconciler } from "../reconcile.js";
import { planReconcile } from "../reconcile.js";
import type { McpConnection } from "./connection.js";
import { McpServerRegistry, type McpServerRecord } from "./registry.js";
import type { McpSupervisor } from "./supervisor.js";

/**
 * The MCP half of reconciling: what the spine asks for, applied to processes.
 *
 * The spine hands over a list of ids and knows nothing else. Everything that
 * makes those ids into running servers is here, which is the seam that lets a
 * fourth kind arrive without either side changing.
 *
 * **Starting is this file's job, not the supervisor's.** The supervisor starts
 * nothing on its own, deliberately — a server nobody has asked for costs
 * nothing while it is not running. This is the thing that asks, because the
 * tool list has to exist before a turn can be built, so a server that is
 * switched on has to be running before anyone calls it rather than at the
 * moment of the first call.
 *
 * **A server that will not start does not stop the others.** Its failure is
 * already held by the supervisor, with the reason and the last thing it said,
 * and it is already being retried. Failing the whole pass would mean one broken
 * server switching off every working one.
 */

export interface McpReconcilerOptions {
  readonly registry: McpServerRegistry;
  readonly supervisor: McpSupervisor;
  readonly onReady?: (
    record: McpServerRecord,
    connection: McpConnection,
  ) => Promise<void> | void;
  readonly onStop?: (serverId: string) => void;
}

export function createMcpReconciler(options: McpReconcilerOptions): KindReconciler {
  const { registry, supervisor } = options;

  /**
   * What each running server was started with.
   *
   * The design did not name this and building it needs it. A record edited in
   * settings — a new command, a different address, a different environment — is
   * not visible in the desired *set*: the id is in both lists, so the plan says
   * do nothing, and the old process keeps running with the old configuration
   * until something restarts the harness. Comparing against what was actually
   * started is the only way to see it.
   *
   * Live state, keyed by id, held next to the thing it describes and never
   * written down — the same rule the supervisor follows.
   */
   const startedWith = new Map<string, McpServerRecord>();

  return async (desired: readonly string[]): Promise<void> => {
    const live = supervisor.statuses().map((status) => status.id);
    const plan = planReconcile(desired, live);

    const stopping = new Set(plan.stop);

    // A record that changed how the server is reached is stopped here and
    // started again below, in one pass. `reachChanged` is the same list of
    // fields that invalidates a permission grant, on purpose: if an edit means
    // the approvals no longer apply, it also means the process no longer
    // matches. A title change is neither, and restarts nothing.
    for (const id of desired) {
      const before = startedWith.get(id);
      const after = registry.get(id);
      if (before === undefined || after === undefined) continue;
      if (McpServerRegistry.reachChanged(before, after)) stopping.add(id);
    }

    for (const id of stopping) {
      // Awaited: the process runs in the project directory, so "stopped"
      // must mean gone before anything acts on that directory again.
      await supervisor.stop(id);
      options.onStop?.(id);
      startedWith.delete(id);
    }

    // Everything the plan wants started, plus what was just stopped for an
    // edit. Deliberately *not* "everything desired that is not in
    // `startedWith`": a server that failed to start is still known to the
    // supervisor and is already being retried with a growing delay, and asking
    // for it again on every turn boundary would reset that delay to nothing.
    // A server that has given up stays given up, which is the point of giving
    // up.
    const toStart = [...plan.start, ...desired.filter((id) => stopping.has(id))];

    await Promise.all(
      toStart.map(async (id) => {
        // Installed and selected disagree with the registry only if a row was
        // removed between the two reads. Nothing to start, and the next pass
        // will not ask again.
        const record = registry.get(id);
        if (record === undefined) return;

        // Remember failed attempts too. Otherwise an edit made while the
        // supervisor's retry timer is pending has no previous record to compare
        // against and leaves the old launch retrying beside the new one.
        startedWith.set(id, record);

        let connection: McpConnection;
        try {
          connection = await supervisor.ensure(record);
        } catch (error) {
          // Deliberately swallowed. The supervisor holds the reason, the last
          // thing the server said, and the retry; raising here would replace a
          // recoverable failure with a pass that stopped half way. Saying it
          // out loud to the user is 003.7.
          return;
        }

        try {
          await options.onReady?.(record, connection);
          startedWith.set(id, record);
        } catch (error) {
          await supervisor.stop(id);
          options.onStop?.(id);
          // A live server with no catalog is not usable. Forget it so the next
          // reconciliation makes one clean attempt rather than claiming the
          // old connection is ready.
          throw error;
        }
      }),
    );
  };
}
