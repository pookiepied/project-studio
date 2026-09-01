import { byLatency, probe, summarize, type HealthReport } from "@pookiepied/core";
import type { Env } from "./env.js";

/**
 * What the auth worker can say about itself. Every probe here is cheap enough
 * to run on a five-minute cron without being a load source of its own.
 */
export async function selfCheck(env: Env): Promise<HealthReport> {
  const started = Date.now();

  const identity = await probe("identity_db", "Identity database", "database", async () => {
    const t0 = Date.now();
    const row = await env.IDENTITY.prepare(
      `SELECT
         (SELECT count(*) FROM users)                                    AS users,
         (SELECT count(*) FROM users WHERE status = 'active')            AS active_users,
         (SELECT count(*) FROM users WHERE status = 'invited')           AS invited_users,
         (SELECT count(*) FROM sessions
           WHERE revoked_at IS NULL AND expires_at > ?)                  AS live_sessions,
         (SELECT count(*) FROM sessions WHERE expires_at <= ?)           AS expired_sessions,
         (SELECT count(*) FROM oauth_flows WHERE expires_at <= ?)        AS stale_flows`,
    )
      .bind(Date.now(), Date.now(), Date.now())
      .first<Record<string, number>>();
    const ms = Date.now() - t0;
    if (!row) throw new Error("identity database returned no rows");

    // Backlog is the signal that the cleanup cron has stopped running — which
    // is exactly the failure a bare liveness check cannot see.
    const backlog = (row.expired_sessions ?? 0) + (row.stale_flows ?? 0);
    const latency = byLatency(ms, 250, 2000);
    return {
      status: backlog > 10_000 ? "degraded" : latency,
      detail: { ...row, query_ms: ms, cleanup_backlog: backlog },
    };
  });

  const config = await probe("oauth_config", "Google OAuth configuration", "internal", async () => {
    const missing = (
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OAUTH_REDIRECT_URI"] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`missing configuration: ${missing.join(", ")}`);
    }
    return {
      detail: {
        redirect_uri: env.OAUTH_REDIRECT_URI,
        session_ttl_days: Number(env.SESSION_TTL_DAYS) || 30,
      },
    };
  });

  return summarize("pookiepied-auth", [identity, config], started);
}
