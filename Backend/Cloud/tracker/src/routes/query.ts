import { Hono } from 'hono';
import { Env } from '../types';

export const queryRoutes = new Hono<{ Bindings: Env }>();

queryRoutes.get('/health', (c) =>
  c.json({ ok: true, service: 'tracker', ts: Date.now() })
);

// GET /events — paginated event log with optional filters
queryRoutes.get('/events', async (c) => {
  const { userId, worker, category, event, severity, from, to, limit = '50', offset = '0' } = c.req.query();

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (userId)   { conditions.push('user_id = ?');  params.push(userId); }
  if (worker)   { conditions.push('worker = ?');   params.push(worker); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (event)    { conditions.push('event = ?');    params.push(event); }
  if (severity) { conditions.push('severity = ?'); params.push(severity); }
  if (from)     { conditions.push('ts >= ?');      params.push(parseInt(from)); }
  if (to)       { conditions.push('ts <= ?');      params.push(parseInt(to)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim   = Math.min(parseInt(limit), 200);
  const off   = parseInt(offset);

  const rows = await c.env.TRACKER_DB.prepare(
    `SELECT * FROM events ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
  ).bind(...params, lim, off).all();

  return c.json({ events: rows.results, limit: lim, offset: off });
});

// GET /runs — list recent agent runs grouped by run_id
queryRoutes.get('/runs', async (c) => {
  const { userId, limit = '20', offset = '0' } = c.req.query();
  const lim = Math.min(parseInt(limit), 100);
  const off = parseInt(offset);

  const where  = userId ? 'WHERE user_id = ?' : '';
  const params = userId ? [userId, lim, off] : [lim, off];

  const rows = await c.env.TRACKER_DB.prepare(`
    SELECT
      run_id,
      user_id,
      MIN(started_at)                                              AS started_at,
      MAX(COALESCE(ended_at, started_at))                         AS last_activity,
      COUNT(*)                                                     AS span_count,
      SUM(COALESCE(tokens_in,  0))                                AS total_tokens_in,
      SUM(COALESCE(tokens_out, 0))                                AS total_tokens_out,
      SUM(COALESCE(cost_usd,   0))                                AS total_cost_usd,
      MAX(CASE WHEN status = 'error'   THEN 1 ELSE 0 END)        AS has_error,
      MAX(CASE WHEN status = 'running' THEN 1 ELSE 0 END)        AS is_running
    FROM spans
    ${where}
    GROUP BY run_id, user_id
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params).all();

  return c.json({ runs: rows.results, limit: lim, offset: off });
});

// GET /runs/:runId — full trace tree for one agent execution
queryRoutes.get('/runs/:runId', async (c) => {
  const runId = c.req.param('runId');

  const [spans, events] = await Promise.all([
    c.env.TRACKER_DB.prepare(
      `SELECT * FROM spans  WHERE run_id = ? ORDER BY started_at ASC`
    ).bind(runId).all(),
    c.env.TRACKER_DB.prepare(
      `SELECT * FROM events WHERE run_id = ? ORDER BY ts ASC`
    ).bind(runId).all(),
  ]);

  return c.json({ runId, spans: spans.results, events: events.results });
});

// GET /tail-events — infrastructure events captured by Cloudflare tail
queryRoutes.get('/tail-events', async (c) => {
  const { worker, outcome, from, to, limit = '50', offset = '0' } = c.req.query();

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (worker)  { conditions.push('worker = ?');  params.push(worker); }
  if (outcome) { conditions.push('outcome = ?'); params.push(outcome); }
  if (from)    { conditions.push('ts >= ?');     params.push(parseInt(from)); }
  if (to)      { conditions.push('ts <= ?');     params.push(parseInt(to)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim   = Math.min(parseInt(limit), 200);
  const off   = parseInt(offset);

  const rows = await c.env.TRACKER_DB.prepare(
    `SELECT * FROM tail_events ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
  ).bind(...params, lim, off).all();

  return c.json({ events: rows.results, limit: lim, offset: off });
});

// GET /summary — platform-wide aggregated stats across all workers
queryRoutes.get('/summary', async (c) => {
  const { userId, from, to } = c.req.query();
  const windowStart = from ? parseInt(from) : Date.now() - 24 * 60 * 60 * 1000;
  const windowEnd   = to   ? parseInt(to)   : Date.now();

  const evtWhere    = ['ts >= ?', 'ts <= ?'];
  const evtParams: unknown[] = [windowStart, windowEnd];
  if (userId) { evtWhere.push('user_id = ?'); evtParams.push(userId); }

  const spnWhere    = ['started_at >= ?', 'started_at <= ?'];
  const spnParams: unknown[] = [windowStart, windowEnd];
  if (userId) { spnWhere.push('user_id = ?'); spnParams.push(userId); }

  const [eventCounts, spanStats, tailStats] = await Promise.all([
    c.env.TRACKER_DB.prepare(`
      SELECT worker, category, event, COUNT(*) AS count
      FROM events
      WHERE ${evtWhere.join(' AND ')}
      GROUP BY worker, category, event
      ORDER BY count DESC
      LIMIT 100
    `).bind(...evtParams).all(),

    c.env.TRACKER_DB.prepare(`
      SELECT
        COUNT(*)                                              AS total_spans,
        COUNT(DISTINCT run_id)                               AS total_runs,
        AVG(duration_ms)                                     AS avg_duration_ms,
        SUM(COALESCE(tokens_in,  0))                        AS total_tokens_in,
        SUM(COALESCE(tokens_out, 0))                        AS total_tokens_out,
        SUM(COALESCE(cost_usd,   0))                        AS total_cost_usd,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)  AS error_spans,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_spans
      FROM spans
      WHERE ${spnWhere.join(' AND ')}
    `).bind(...spnParams).all(),

    c.env.TRACKER_DB.prepare(`
      SELECT worker, outcome, COUNT(*) AS count
      FROM tail_events
      WHERE ts >= ? AND ts <= ?
      GROUP BY worker, outcome
      ORDER BY count DESC
    `).bind(windowStart, windowEnd).all(),
  ]);

  return c.json({
    window: { from: windowStart, to: windowEnd },
    events:         eventCounts.results,
    spans:          spanStats.results[0] ?? {},
    infrastructure: tailStats.results,
  });
});
