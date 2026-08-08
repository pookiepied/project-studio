import { Hono } from 'hono';
import { Env } from '../types';

export const usageRoutes = new Hono<{ Bindings: Env }>();

// GET /usage/summary — 30-day overview + per-provider breakdown
usageRoutes.get('/usage/summary', async (c) => {
  const { userId, days: daysParam } = c.req.query();
  const days = Math.min(parseInt(daysParam ?? '30'), 90);

  const conditions = [`created_at >= datetime('now', '-' || ? || ' days')`];
  const binds: (string | number)[] = [days];
  if (userId) { conditions.push('user_id = ?'); binds.push(userId); }
  const where = conditions.join(' AND ');

  const [overview, byProvider, credits] = await Promise.all([
    c.env.TRACKER_DB.prepare(`
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(input_tokens),  0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        SUM(COALESCE(cost_usd, estimated_cost_usd)) as total_cost_usd,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as error_count
      FROM usage_events WHERE ${where}
    `).bind(...binds).first<{
      total_requests: number; total_input_tokens: number;
      total_output_tokens: number; total_cost_usd: number | null;
      success_count: number; error_count: number;
    }>(),

    c.env.TRACKER_DB.prepare(`
      SELECT
        provider,
        COUNT(*) as requests,
        SUM(COALESCE(cost_usd, estimated_cost_usd)) as cost_usd,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as error_count,
        ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate
      FROM usage_events WHERE ${where}
      GROUP BY provider ORDER BY requests DESC
    `).bind(...binds).all<{
      provider: string; requests: number; cost_usd: number | null;
      success_count: number; error_count: number; success_rate: number;
    }>(),

    c.env.TRACKER_DB.prepare(
      `SELECT provider, balance_usd, used_usd, purchased_usd, updated_at FROM provider_credits ORDER BY provider`
    ).all<{ provider: string; balance_usd: number | null; used_usd: number | null; purchased_usd: number | null; updated_at: string }>(),
  ]);

  const total        = overview?.total_requests ?? 0;
  const successCount = overview?.success_count  ?? 0;

  return c.json({
    window_days: days,
    total_requests:      total,
    total_input_tokens:  overview?.total_input_tokens  ?? 0,
    total_output_tokens: overview?.total_output_tokens ?? 0,
    total_cost_usd:      overview?.total_cost_usd      ?? null,
    success_rate:        total > 0 ? Math.round(1000 * successCount / total) / 10 : null,
    error_count:         overview?.error_count ?? 0,
    by_provider:         byProvider.results,
    credits:             credits.results,
  });
});

// GET /usage/data — grouped usage (by day | provider | model | source)
usageRoutes.get('/usage/data', async (c) => {
  const { userId, days: daysParam, provider, group_by: groupBy = 'day' } = c.req.query();
  const days = Math.min(parseInt(daysParam ?? '30'), 90);

  const GROUP_BY_COLUMNS: Record<string, string> = {
    provider: 'provider',
    model:    'model',
    source:   "COALESCE(source, 'direct')",
    day:      "date(created_at)",
  };
  const selectLabel = GROUP_BY_COLUMNS[groupBy] ?? "date(created_at)";

  const conditions = [`created_at >= datetime('now', '-' || ? || ' days')`];
  const binds: (string | number)[] = [days];
  if (userId)   { conditions.push('user_id = ?');  binds.push(userId); }
  if (provider) { conditions.push('provider = ?'); binds.push(provider); }

  const rows = await c.env.TRACKER_DB.prepare(`
    SELECT ${selectLabel} as label,
      COUNT(*) as requests,
      COALESCE(SUM(input_tokens),  0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      SUM(COALESCE(cost_usd, estimated_cost_usd)) as cost_usd,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as error_count
    FROM usage_events
    WHERE ${conditions.join(' AND ')}
    GROUP BY ${selectLabel}
    ORDER BY ${groupBy === 'day' ? 'label ASC' : 'requests DESC'}
  `).bind(...binds).all<{
    label: string; requests: number; input_tokens: number;
    output_tokens: number; cost_usd: number | null;
    success_count: number; error_count: number;
  }>();

  return c.json({ group_by: groupBy, days, data: rows.results });
});

// GET /usage/logs — paginated request log with optional filters
usageRoutes.get('/usage/logs', async (c) => {
  const { userId, limit: limitParam = '50', cursor, provider, source, status } = c.req.query();
  const limit = Math.min(parseInt(limitParam), 100);

  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (userId)   { conditions.push('user_id = ?');                       binds.push(userId); }
  if (cursor)   { conditions.push('created_at < ?');                    binds.push(cursor); }
  if (provider) { conditions.push('provider = ?');                      binds.push(provider); }
  if (source)   { conditions.push("COALESCE(source, 'direct') = ?");    binds.push(source); }
  if (status)   { conditions.push('status = ?');                        binds.push(status); }
  binds.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await c.env.TRACKER_DB.prepare(`
    SELECT id, created_at, user_id, provider, model,
           input_tokens, output_tokens, cache_read_tokens,
           cost_usd, estimated_cost_usd, latency_ms,
           generation_id, request_type, status, error_type,
           source, tool_call_count, run_id
    FROM usage_events
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...binds).all<{
    id: string; created_at: string; user_id: string; provider: string; model: string;
    input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null;
    cost_usd: number | null; estimated_cost_usd: number | null; latency_ms: number | null;
    generation_id: string | null; request_type: string;
    status: string; error_type: string | null; source: string | null;
    tool_call_count: number | null; run_id: string | null;
  }>();

  const events      = rows.results;
  const next_cursor = events.length === limit ? (events[events.length - 1]?.created_at ?? null) : null;

  return c.json({ events, next_cursor, count: events.length });
});

// GET /usage/credits — latest provider credit balances
usageRoutes.get('/usage/credits', async (c) => {
  const rows = await c.env.TRACKER_DB.prepare(
    `SELECT provider, balance_usd, used_usd, purchased_usd, updated_at
     FROM provider_credits ORDER BY provider`
  ).all<{ provider: string; balance_usd: number | null; used_usd: number | null; purchased_usd: number | null; updated_at: string }>();

  return c.json({ credits: rows.results });
});

// DELETE /usage/cleanup — remove events older than the retention window (default 30 days)
usageRoutes.delete('/usage/cleanup', async (c) => {
  const { days: daysParam = '30' } = c.req.query();
  const days = Math.min(parseInt(daysParam), 90);

  const result = await c.env.TRACKER_DB.prepare(
    `DELETE FROM usage_events WHERE created_at < datetime('now', '-' || ? || ' days')`
  ).bind(days).run();

  const deleted = (result.meta as any)?.changes ?? 0;
  return c.json({ ok: true, deleted, days });
});
