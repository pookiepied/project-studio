/**
 * Read-only view of Analytics Engine. The console asks questions; it never
 * writes telemetry and holds no ingest key.
 */
export interface AnalyticsEnv {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  ANALYTICS_DATASET: string;
}

export async function query<T>(env: AnalyticsEnv, sql: string): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "text/plain",
      },
      body: sql,
    },
  );
  if (!res.ok) {
    console.error(JSON.stringify({ evt: "analytics_query_failed", status: res.status }));
    throw new Error("analytics_unavailable");
  }
  const body = (await res.json()) as { data: T[] };
  return body.data ?? [];
}

export const recentRequests = (env: AnalyticsEnv, hours = 24) =>
  query<{ source: string; requests: number; errors: number; p95_ms: number }>(
    env,
    `SELECT index1 AS source,
            count() AS requests,
            sum(if(double1 >= 400, 1, 0)) AS errors,
            quantile(0.95)(double2) AS p95_ms
       FROM ${env.ANALYTICS_DATASET}
      WHERE timestamp > now() - INTERVAL '${Number(hours) || 24}' HOUR
        AND blob1 = 'request'
      GROUP BY source
      ORDER BY requests DESC
      FORMAT JSON`,
  );

export const recentErrors = (env: AnalyticsEnv, hours = 24) =>
  query<{ source: string; path: string; event: string; n: number }>(
    env,
    `SELECT index1 AS source, blob2 AS path, blob1 AS event, count() AS n
       FROM ${env.ANALYTICS_DATASET}
      WHERE timestamp > now() - INTERVAL '${Number(hours) || 24}' HOUR
        AND (blob1 = 'exception' OR double1 >= 500)
      GROUP BY source, path, event
      ORDER BY n DESC
      LIMIT 50
      FORMAT JSON`,
  );

/**
 * The Analytics Engine SQL API takes a string, so there is nothing to bind a
 * parameter to. Every value that reaches a query goes through here first; a
 * filter that fails the pattern is dropped rather than escaped, because a
 * filter is never worth a query it can rewrite.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.:/-]{1,64}$/;

function literal(value: string | null | undefined): string | null {
  if (!value || !SAFE_TOKEN.test(value)) return null;
  return `'${value}'`;
}

function hoursClause(hours: number): string {
  const h = Number.isFinite(hours) ? Math.min(Math.max(Math.trunc(hours), 1), 720) : 24;
  return `timestamp > now() - INTERVAL '${h}' HOUR`;
}

export interface ActivityRow {
  ts: string;
  source: string;
  event: string;
  path: string;
  outcome: string;
  status: number;
  duration_ms: number;
  fields: string;
}

export interface ActivityFilter {
  hours?: number;
  source?: string | null;
  event?: string | null;
  /** "errors" keeps 4xx/5xx and exceptions; "all" keeps everything. */
  only?: "all" | "errors";
  limit?: number;
}

export function activity(env: AnalyticsEnv, filter: ActivityFilter = {}) {
  const where = [hoursClause(filter.hours ?? 24)];

  const source = literal(filter.source);
  if (source) where.push(`index1 = ${source}`);

  const event = literal(filter.event);
  if (event) where.push(`blob1 = ${event}`);

  if (filter.only === "errors") where.push(`(double1 >= 400 OR blob1 = 'exception')`);

  // Heartbeats are machinery, not activity. They have their own page.
  where.push(`blob1 NOT IN ('health', 'heartbeat_probe')`);

  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 200), 1), 1000);

  return query<ActivityRow>(
    env,
    `SELECT timestamp AS ts, index1 AS source, blob1 AS event, blob2 AS path,
            blob3 AS outcome, double1 AS status, double2 AS duration_ms, blob4 AS fields
       FROM ${env.ANALYTICS_DATASET}
      WHERE ${where.join(" AND ")}
      ORDER BY ts DESC
      LIMIT ${limit}
      FORMAT JSON`,
  );
}

/** The set of sources and event names actually present, for building filters. */
export function facets(env: AnalyticsEnv, hours = 24) {
  return Promise.all([
    query<{ source: string; n: number }>(
      env,
      `SELECT index1 AS source, count() AS n FROM ${env.ANALYTICS_DATASET}
        WHERE ${hoursClause(hours)} GROUP BY source ORDER BY n DESC LIMIT 50 FORMAT JSON`,
    ),
    query<{ event: string; n: number }>(
      env,
      `SELECT blob1 AS event, count() AS n FROM ${env.ANALYTICS_DATASET}
        WHERE ${hoursClause(hours)} AND blob1 NOT IN ('health','heartbeat_probe')
        GROUP BY event ORDER BY n DESC LIMIT 50 FORMAT JSON`,
    ),
  ]).then(([sources, events]) => ({ sources, events }));
}

export function summary(env: AnalyticsEnv, hours = 24) {
  return query<{
    source: string;
    requests: number;
    errors: number;
    p50_ms: number;
    p95_ms: number;
  }>(
    env,
    `SELECT index1 AS source,
            count() AS requests,
            sum(if(double1 >= 400, 1, 0)) AS errors,
            quantile(0.50)(double2) AS p50_ms,
            quantile(0.95)(double2) AS p95_ms
       FROM ${env.ANALYTICS_DATASET}
      WHERE ${hoursClause(hours)} AND blob1 = 'request'
      GROUP BY source
      ORDER BY requests DESC
      FORMAT JSON`,
  );
}
