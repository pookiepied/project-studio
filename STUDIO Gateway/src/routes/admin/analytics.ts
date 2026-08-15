/**
 * Admin analytics and request inspection endpoints.
 * All values are derived from normalized gateway_requests records.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { notFound } from "../../lib/errors.ts";

export const adminAnalyticsRoute = new Hono<{ Bindings: Env }>();

adminAnalyticsRoute.get("/analytics/overview", async (c) => {
  requireAdmin(c as never);
  const range = normalizeRange(c.req.query("range"));
  const to = Date.now();
  const from = to - rangeMs(range);
  const db = c.env.DB;
  const where = "created_at >= ? AND created_at <= ?";
  const args = [from, to];
  const bucketFormat = range === "24h" ? "%Y-%m-%dT%H:00:00Z" : "%Y-%m-%d";

  const [summary, timeseries, models, providers, tokens] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total_requests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0) AS successful_requests,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS error_requests,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(SUM(cost), 0) AS cost,
          COALESCE(AVG(total_latency_ms), 0) AS avg_latency_ms,
          COALESCE(AVG(provider_latency_ms), 0) AS avg_provider_latency_ms,
          COALESCE(AVG(routing_latency_ms), 0) AS avg_routing_latency_ms,
          COALESCE(AVG(time_to_first_token_ms), 0) AS avg_time_to_first_token_ms,
          COALESCE(AVG(tokens_per_second), 0) AS avg_tokens_per_second
        FROM gateway_requests WHERE ${where}`,
      )
      .bind(...args)
      .first(),
    db
      .prepare(
        `SELECT strftime('${bucketFormat}', created_at / 1000, 'unixepoch') AS day,
          COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(AVG(total_latency_ms), 0) AS avg_latency_ms
        FROM gateway_requests WHERE ${where} GROUP BY day ORDER BY day ASC`,
      )
      .bind(...args)
      .all(),
    db
      .prepare(
        `SELECT model_id, provider_id, model_category, COUNT(*) AS requests,
          COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(cost), 0) AS cost,
          COALESCE(AVG(total_latency_ms), 0) AS avg_latency_ms
        FROM gateway_requests WHERE ${where} AND model_id IS NOT NULL
        GROUP BY model_id, provider_id, model_category ORDER BY requests DESC LIMIT 25`,
      )
      .bind(...args)
      .all(),
    db
      .prepare(
        `SELECT provider_id, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(cost), 0) AS cost, COALESCE(AVG(provider_latency_ms), 0) AS avg_latency_ms
        FROM gateway_requests WHERE ${where} AND provider_id IS NOT NULL
        GROUP BY provider_id ORDER BY requests DESC`,
      )
      .bind(...args)
      .all(),
    db
      .prepare(
        `SELECT gateway_key_id, gateway_key_name, COUNT(*) AS requests,
          COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(cost), 0) AS cost
        FROM gateway_requests WHERE ${where} AND gateway_key_id IS NOT NULL
        GROUP BY gateway_key_id, gateway_key_name ORDER BY requests DESC LIMIT 25`,
      )
      .bind(...args)
      .all(),
  ]);

  const values = (summary ?? {}) as Record<string, unknown>;
  const inputTokens = number(values.input_tokens);
  const cacheReadTokens = number(values.cache_read_tokens);
  return c.json({
    range,
    from,
    to,
    summary: {
      totalRequests: number(values.total_requests),
      successfulRequests: number(values.successful_requests),
      errorRequests: number(values.error_requests),
      inputTokens,
      outputTokens: number(values.output_tokens),
      totalTokens: number(values.total_tokens),
      cacheReadTokens,
      cacheWriteTokens: number(values.cache_write_tokens),
      cacheReadRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
      cost: number(values.cost),
      avgLatencyMs: number(values.avg_latency_ms),
      avgProviderLatencyMs: number(values.avg_provider_latency_ms),
      avgRoutingLatencyMs: number(values.avg_routing_latency_ms),
      avgTimeToFirstTokenMs: number(values.avg_time_to_first_token_ms),
      avgTokensPerSecond: number(values.avg_tokens_per_second),
    },
    timeseries: timeseries.results ?? [],
    models: models.results ?? [],
    providers: providers.results ?? [],
    tokens: tokens.results ?? [],
  });
});

adminAnalyticsRoute.get("/requests", async (c) => {
  requireAdmin(c as never);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (condition: string, ...args: unknown[]) => {
    where.push(condition);
    values.push(...args);
  };
  if (c.req.query("model")) add("r.model_id = ?", c.req.query("model"));
  if (c.req.query("provider")) add("r.provider_id = ?", c.req.query("provider"));
  if (c.req.query("token")) add("r.gateway_key_id = ?", c.req.query("token"));
  if (c.req.query("application")) add("r.application = ?", c.req.query("application"));
  if (c.req.query("status")) add("r.status_code = ?", Number(c.req.query("status")) || 0);
  if (c.req.query("from")) add("r.created_at >= ?", Number(c.req.query("from")) || 0);
  if (c.req.query("to")) add("r.created_at <= ?", Number(c.req.query("to")) || Date.now());
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await c.env.DB
    .prepare(
      `SELECT r.request_id, r.generation_id, r.created_at, r.completed_at, r.method, r.path,
        r.status_code, r.gateway_key_id, r.gateway_key_name, r.application, r.model_id,
        r.provider_id, r.model_category, r.streaming, r.reasoning_used, r.tools_called,
        r.fallback_used, r.finish_reason, r.input_tokens, r.output_tokens, r.total_tokens,
        r.cached_tokens, r.cache_read_tokens, r.cost, r.routing_latency_ms, r.provider_latency_ms,
        r.total_latency_ms, r.time_to_first_token_ms, r.tokens_per_second, r.error_code
      FROM gateway_requests r ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, limit, offset)
    .all();
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM gateway_requests r ${whereSql}`).bind(...values).first<{ count: number }>();
  return c.json({ data: rows.results ?? [], total: count?.count ?? 0, limit, offset });
});

adminAnalyticsRoute.get("/requests/:id", async (c) => {
  requireAdmin(c as never);
  const row = await c.env.DB
    .prepare(
      `SELECT r.*, p.name AS provider_name, p.base_url AS provider_base_url,
        m.display_name AS model_display_name, m.input_modalities, m.output_modalities,
        m.context_window, m.max_output_tokens, m.pricing_input, m.pricing_output,
        m.pricing_cache_read, m.pricing_cache_write, m.supports_tools, m.supports_vision,
        m.supports_reasoning, m.family, m.lab, m.open_weights, m.knowledge_cutoff
      FROM gateway_requests r
      LEFT JOIN providers p ON p.id = r.provider_id
      LEFT JOIN models m ON m.provider_id = r.provider_id AND m.model_id = r.model_id
      WHERE r.request_id = ?`,
    )
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!row) throw notFound("Request not found");
  for (const key of ["input_modalities", "output_modalities"]) {
    if (typeof row[key] === "string") {
      try { row[key] = JSON.parse(row[key] as string); } catch { row[key] = null; }
    }
  }
  return c.json({ data: row });
});

function normalizeRange(value: string | undefined): "24h" | "7d" | "30d" {
  return value === "24h" || value === "7d" || value === "30d" ? value : "30d";
}

function rangeMs(range: "24h" | "7d" | "30d"): number {
  if (range === "24h") return 24 * 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}
