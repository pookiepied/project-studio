/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import { Env } from './types';
import { ingestRoutes } from './routes/ingest';
import { queryRoutes }  from './routes/query';
import { usageRoutes }  from './routes/usage';
import { newId } from './lib/id';

const app = new Hono<{ Bindings: Env }>();

app.route('/', ingestRoutes);
app.route('/', queryRoutes);
app.route('/', usageRoutes);

// ── Cloudflare Tail Handler ───────────────────────────────────────────────────
// Receives infrastructure events from all workers that list this worker as a
// tail_consumer in their wrangler.toml. No code changes needed in source workers.

async function processTailEvents(events: TraceItem[], env: Env): Promise<void> {
  if (!events.length) return;

  const stmt = env.TRACKER_DB.prepare(
    `INSERT INTO tail_events (id, ts, worker, outcome, event_type, url, method, logs, exceptions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batch = events.map((item) => {
    const req  = item.event instanceof Request ? item.event : null;

    const logs = item.logs?.length
      ? JSON.stringify(item.logs.map((l) => ({
          level:   l.level,
          message: l.message.join(' '),
          ts:      l.timestamp,
        })))
      : null;

    const exceptions = item.exceptions?.length
      ? JSON.stringify(item.exceptions.map((e) => ({
          name:    e.name,
          message: e.message,
          ts:      e.timestamp,
        })))
      : null;

    return stmt.bind(
      newId(),
      item.eventTimestamp ?? Date.now(),
      item.scriptName ?? 'unknown',
      item.outcome,
      req ? 'fetch' : 'scheduled',
      req ? req.url  : null,
      req ? req.method : null,
      logs,
      exceptions
    );
  });

  await env.TRACKER_DB.batch(batch);
}

export default {
  fetch: app.fetch.bind(app),

  async tail(events: TraceItem[], env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processTailEvents(events, env));
  },
};
