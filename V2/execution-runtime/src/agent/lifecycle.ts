import type { RunState, RunStatus } from "@studio/v2-contracts";

/**
 * Loop lifecycle rules (ARCHITECTURE.md §7, RUNTIME-CHECKLIST.md §3): the
 * single place that decides which status transitions are legal, when a run
 * counts as stalled, and what the retry policy allows. The ExecutionSession
 * consults these; nothing else mutates run status.
 *
 * Working phases (reasoning / tool_calls_pending / tools_running / responding)
 * move freely between each other — the model interleaves text and tool calls
 * as it pleases. What the matrix forbids is resurrecting terminal runs,
 * skipping the pausing/cancelling intents, and re-entering work from a
 * settled state without going through `recovering`.
 */

const WORKING: readonly RunStatus[] = [
  "reasoning",
  "tool_calls_pending",
  "tools_running",
  "responding",
];

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["starting", "cancelling", "expired"],
  starting: [...WORKING, "pausing", "cancelling", "failed"],
  reasoning: [...WORKING, "waiting_for_approval", "pausing", "cancelling", "completed", "failed", "recovering"],
  tool_calls_pending: [...WORKING, "waiting_for_approval", "pausing", "cancelling", "failed", "recovering"],
  tools_running: [...WORKING, "waiting_for_approval", "waiting_for_external_result", "pausing", "cancelling", "failed", "recovering"],
  waiting_for_approval: ["tools_running", "reasoning", "pausing", "cancelling", "failed", "expired"],
  waiting_for_external_result: ["tools_running", "reasoning", "pausing", "cancelling", "failed", "expired", "recovering"],
  responding: [...WORKING, "waiting_for_approval", "pausing", "cancelling", "completed", "failed", "recovering"],
  pausing: ["paused", "cancelling", "failed"],
  paused: ["recovering", "cancelling", "expired"],
  cancelling: ["cancelled", "failed"],
  recovering: [...WORKING, "paused", "cancelling", "failed"],
  cancelled: [],
  completed: [],
  failed: [],
  expired: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return from !== to && TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RunStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses in which the loop is (or should be) executing right now. */
export function isExecuting(status: RunStatus): boolean {
  return (
    (WORKING as readonly string[]).includes(status) ||
    status === "starting" ||
    status === "recovering"
  );
}

/** Non-terminal = counts as "the active run" for the single-run invariant. */
export function isActive(status: RunStatus): boolean {
  return !isTerminal(status);
}

/** All non-terminal statuses (used for the active-run SQL projection). */
export const ACTIVE_STATUSES: readonly RunStatus[] = (
  Object.keys(TRANSITIONS) as RunStatus[]
).filter((s) => !isTerminal(s));

/** No progress for this long while executing → the watchdog intervenes. */
export const STALL_TIMEOUT_MS = 120_000;

/** Watchdog cadence while a run is active. */
export const WATCHDOG_INTERVAL_MS = 30_000;

export const MAX_RETRY_ATTEMPTS = 3;

/** Exponential backoff for provider/tool retries. */
export function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

export function isStalled(run: RunState, now: Date): boolean {
  if (!isExecuting(run.status)) return false;
  return now.getTime() - new Date(run.updatedAt).getTime() > STALL_TIMEOUT_MS;
}

export function canRetry(run: RunState): boolean {
  return run.retryAttempts < MAX_RETRY_ATTEMPTS;
}
