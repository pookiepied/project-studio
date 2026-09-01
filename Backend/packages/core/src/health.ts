/**
 * Health, as a report rather than a status code.
 *
 * A bare 200 answers the least interesting question — the worker ran. What is
 * worth knowing is which dependency is slow, how slow, and with what numbers
 * around it: rows pending cleanup, sessions live, keys configured. So a check
 * carries a latency and a free-form `detail` bag, and the report is the union
 * of its checks.
 *
 * Three states, because two cannot express the common case. `degraded` is a
 * dependency that answered but badly — slow, or holding more backlog than it
 * should. It is not an outage and must not page anyone, but it is the thing you
 * want to see before it becomes one.
 */
export type HealthStatus = "ok" | "degraded" | "down";

export type CheckKind = "database" | "analytics" | "binding" | "external" | "internal";

export interface HealthCheck {
  id: string;
  label: string;
  kind: CheckKind;
  status: HealthStatus;
  /** Wall time for the probe, or null if it never ran. */
  latencyMs: number | null;
  /** Whatever this dependency can usefully say about itself. */
  detail?: Record<string, string | number | boolean | null>;
  /** Present only when the probe failed. Never a stack trace. */
  error?: string;
}

export interface HealthReport {
  service: string;
  status: HealthStatus;
  observedAt: number;
  durationMs: number;
  checks: HealthCheck[];
}

/** What a probe may report back. Returning nothing means "ok, no detail". */
export interface ProbeResult {
  status?: HealthStatus;
  detail?: Record<string, string | number | boolean | null>;
}

const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };

/**
 * Runs one probe, times it, and turns a throw into `down` rather than letting
 * it take the whole report with it. A health endpoint that 500s because one
 * dependency is unreachable has told you strictly less than one that reports
 * which dependency it was.
 */
export async function probe(
  id: string,
  label: string,
  kind: CheckKind,
  fn: () => Promise<ProbeResult | void>,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const result = (await fn()) ?? {};
    const check: HealthCheck = {
      id,
      label,
      kind,
      status: result.status ?? "ok",
      latencyMs: Date.now() - started,
    };
    if (result.detail) check.detail = result.detail;
    return check;
  } catch (err) {
    return {
      id,
      label,
      kind,
      status: "down",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The report's status is its worst check. No weighting, no averaging. */
export function summarize(
  service: string,
  checks: HealthCheck[],
  startedAt: number,
): HealthReport {
  let status: HealthStatus = "ok";
  for (const c of checks) if (RANK[c.status] > RANK[status]) status = c.status;
  return {
    service,
    status,
    observedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    checks,
  };
}

/**
 * `degraded` stays 200: it is information, not an outage, and a monitor that
 * pages on it will be muted within a week and then miss the real thing.
 */
export const httpStatusFor = (status: HealthStatus): number => (status === "down" ? 503 : 200);

/** Classify a latency against a threshold pair, the common shape of a probe. */
export function byLatency(ms: number, degradedOver: number, downOver: number): HealthStatus {
  if (ms >= downOver) return "down";
  if (ms >= degradedOver) return "degraded";
  return "ok";
}
