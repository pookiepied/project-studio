import { probe, summarize, byLatency, type HealthReport, type HealthStatus } from "@pookiepied/core";
import { query, type AnalyticsEnv } from "./analytics.js";

export interface HealthEnv extends AnalyticsEnv {
  ADMIN: { health(): Promise<HealthReport> };
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

/** One service's last known state, however we came to know it. */
export interface ServiceHealth extends HealthReport {
  /** "live" was probed just now; "heartbeat" is the last cron report. */
  origin: "live" | "heartbeat";
  /** Seconds since the report was produced. Staleness is the outage signal. */
  ageSeconds: number;
}

const HEARTBEAT_STALE_AFTER_S = 15 * 60;

async function consoleSelf(env: HealthEnv): Promise<HealthReport> {
  const started = Date.now();

  const analytics = await probe("analytics_read", "Analytics Engine (read)", "analytics", async () => {
    const t0 = Date.now();
    const rows = await query<{ n: number }>(
      env,
      `SELECT count() AS n FROM ${env.ANALYTICS_DATASET}
        WHERE timestamp > now() - INTERVAL '1' HOUR FORMAT JSON`,
    );
    const ms = Date.now() - t0;
    return {
      status: byLatency(ms, 1500, 8000),
      detail: { events_last_hour: rows[0]?.n ?? 0, query_ms: ms },
    };
  });

  const access = await probe("access_certs", "Cloudflare Access JWKS", "external", async () => {
    const t0 = Date.now();
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`certs endpoint returned ${res.status}`);
    const body = (await res.json()) as { keys?: unknown[] };
    const ms = Date.now() - t0;
    return {
      status: byLatency(ms, 800, 5000),
      detail: { keys: body.keys?.length ?? 0, team_domain: env.ACCESS_TEAM_DOMAIN, fetch_ms: ms },
    };
  });

  return summarize("pookiepied-console", [analytics, access], started);
}

/**
 * The status page's data.
 *
 * Auth is probed live because its failure takes every app down and five minutes
 * is too long to wait to find out. Everything else is read from its last
 * heartbeat — which also means a service that has stopped reporting shows up as
 * stale rather than as absent-and-unexplained.
 */
export async function aggregate(env: HealthEnv): Promise<{
  status: HealthStatus;
  services: ServiceHealth[];
  checkedAt: number;
}> {
  const now = Date.now();
  const services: ServiceHealth[] = [];

  const live = await Promise.allSettled([consoleSelf(env), env.ADMIN.health()]);
  for (const r of live) {
    if (r.status === "fulfilled") {
      services.push({ ...r.value, origin: "live", ageSeconds: 0 });
    } else {
      services.push({
        service: "pookiepied-auth",
        status: "down",
        observedAt: now,
        durationMs: 0,
        origin: "live",
        ageSeconds: 0,
        checks: [
          {
            id: "service_binding",
            label: "Auth service binding",
            kind: "binding",
            status: "down",
            latencyMs: null,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          },
        ],
      });
    }
  }

  const named = new Set(services.map((s) => s.service));

  // Heartbeats for anything not probed above. Newest row per service wins.
  try {
    const rows = await query<{ source: string; report: string; ts: string }>(
      env,
      `SELECT index1 AS source, blob4 AS report, max(timestamp) AS ts
         FROM ${env.ANALYTICS_DATASET}
        WHERE blob1 = 'health' AND timestamp > now() - INTERVAL '24' HOUR
        GROUP BY source, report
        ORDER BY ts DESC
        LIMIT 50
        FORMAT JSON`,
    );
    for (const row of rows) {
      if (named.has(row.source)) continue;
      named.add(row.source);
      const observedAt = Date.parse(row.ts);
      let parsed: HealthReport | null = null;
      try {
        parsed = JSON.parse(row.report) as HealthReport;
      } catch {
        parsed = null;
      }
      const ageSeconds = Math.max(0, Math.round((now - observedAt) / 1000));
      const stale = ageSeconds > HEARTBEAT_STALE_AFTER_S;
      services.push({
        service: row.source,
        // A stale heartbeat is not a healthy service, whatever it last claimed.
        status: stale ? "down" : (parsed?.status ?? "degraded"),
        observedAt,
        durationMs: parsed?.durationMs ?? 0,
        checks: stale
          ? [
              {
                id: "heartbeat",
                label: "Heartbeat",
                kind: "internal",
                status: "down",
                latencyMs: null,
                error: `no report for ${Math.round(ageSeconds / 60)} minutes`,
              },
              ...(parsed?.checks ?? []),
            ]
          : (parsed?.checks ?? []),
        origin: "heartbeat",
        ageSeconds,
      });
    }
  } catch {
    // Analytics being unreachable is already reported by the console's own
    // check above; it must not empty the whole page.
  }

  const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };
  let status: HealthStatus = "ok";
  for (const s of services) if (RANK[s.status] > RANK[status]) status = s.status;

  return { status, services, checkedAt: now };
}
