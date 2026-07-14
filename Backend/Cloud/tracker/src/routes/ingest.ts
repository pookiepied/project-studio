import { Hono } from 'hono';
import { Env, TrackEvent, SpanStartPayload, SpanEndPayload, UsageEventPayload, CreditsPayload } from '../types';
import { newId } from '../lib/id';

export const ingestRoutes = new Hono<{ Bindings: Env }>();

// POST /ingest — record a business event from any worker
ingestRoutes.post('/ingest', async (c) => {
  const body = await c.req.json<TrackEvent>();
  await c.env.TRACKER_DB.prepare(
    `INSERT INTO events (id, ts, worker, category, event, severity, user_id, session_id, run_id, span_id, parent_span_id, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId(),
    Date.now(),
    body.worker   ?? 'unknown',
    body.category ?? 'system',
    body.event,
    body.severity ?? 'info',
    body.userId        ?? null,
    body.sessionId     ?? null,
    body.runId         ?? null,
    body.spanId        ?? null,
    body.parentSpanId  ?? null,
    body.data ? JSON.stringify(body.data) : null
  ).run();

  return c.json({ ok: true });
});

// POST /ingest/span — open a new agent trace span
ingestRoutes.post('/ingest/span', async (c) => {
  const body = await c.req.json<SpanStartPayload>();
  await c.env.TRACKER_DB.prepare(
    `INSERT INTO spans (span_id, run_id, parent_span_id, span_type, name, user_id, started_at, status, input_preview, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
     ON CONFLICT(span_id) DO NOTHING`
  ).bind(
    body.spanId,
    body.runId,
    body.parentSpanId ?? null,
    body.spanType,
    body.name,
    body.userId       ?? null,
    Date.now(),
    body.inputPreview ? body.inputPreview.slice(0, 4000) : null,
    body.metadata ? JSON.stringify(body.metadata) : null
  ).run();

  return c.json({ ok: true });
});

// POST /ingest/span/:spanId/end — close a span with result data
ingestRoutes.post('/ingest/span/:spanId/end', async (c) => {
  const spanId  = c.req.param('spanId');
  const body    = await c.req.json<SpanEndPayload>();
  const endedAt = Date.now();

  await c.env.TRACKER_DB.prepare(
    `UPDATE spans
     SET ended_at = ?, duration_ms = ? - started_at, status = ?,
         output_preview = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?, error = ?
     WHERE span_id = ?`
  ).bind(
    endedAt,
    endedAt,
    body.status,
    body.outputPreview ? body.outputPreview.slice(0, 4000) : null,
    body.tokensIn  ?? null,
    body.tokensOut ?? null,
    body.costUsd   ?? null,
    body.error     ?? null,
    spanId
  ).run();

  return c.json({ ok: true });
});

// POST /ingest/usage — record a single AI request's token/cost/latency data
ingestRoutes.post('/ingest/usage', async (c) => {
  const body = await c.req.json<UsageEventPayload>();
  await c.env.TRACKER_DB.prepare(
    `INSERT INTO usage_events
      (id, created_at, user_id, provider, model,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       cost_usd, estimated_cost_usd, latency_ms, input_preview, generation_id,
       request_type, status, error_type, source, tool_call_count, iteration_count, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId(),
    new Date().toISOString(),
    body.userId,
    body.provider,
    body.model,
    body.inputTokens       ?? null,
    body.outputTokens      ?? null,
    body.cacheReadTokens   ?? null,
    body.cacheWriteTokens  ?? null,
    body.costUsd           ?? null,
    body.estimatedCostUsd  ?? null,
    body.latencyMs         ?? null,
    body.inputPreview      ?? null,
    body.generationId      ?? null,
    body.requestType       ?? 'chat',
    body.status            ?? 'success',
    body.errorType         ?? null,
    body.source            ?? null,
    body.toolCallCount     ?? null,
    body.iterationCount    ?? null,
    body.runId             ?? null,
  ).run();

  return c.json({ ok: true });
});

// POST /ingest/credits — upsert latest provider credit balance snapshot
ingestRoutes.post('/ingest/credits', async (c) => {
  const body = await c.req.json<CreditsPayload>();
  await c.env.TRACKER_DB.prepare(
    `INSERT OR REPLACE INTO provider_credits
      (provider, balance_usd, used_usd, purchased_usd, raw_response, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.provider,
    body.balance_usd   ?? null,
    body.used_usd      ?? null,
    body.purchased_usd ?? null,
    body.raw_response ? JSON.stringify(body.raw_response) : null,
    body.updated_at,
  ).run();

  return c.json({ ok: true });
});
