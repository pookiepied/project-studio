/**
 * Admin - models listing with filtering for dashboard
 * GET /admin/models?category=text&provider=anthropic&exposed=true&search=claude
 * Bulk expose: POST /admin/models/bulk { modelIds: [{provider_id, model_id}], exposed: true }
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { badRequest, conflict } from "../../lib/errors.ts";

export const adminModelsRoute = new Hono<{ Bindings: Env }>();

adminModelsRoute.get("/models", async (c) => {
  requireAdmin(c as never);
  const category = c.req.query("category");
  const provider = c.req.query("provider");
  const exposed = c.req.query("exposed");
  const search = c.req.query("search");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

  const where: string[] = [];
  const vals: unknown[] = [];
  const ALLOWED_CATEGORIES = new Set(["text", "image", "embedding", "audio", "speech", "transcription", "video", "rerank"])
  if (category) {
    if (!ALLOWED_CATEGORIES.has(category)) throw badRequest(`Invalid category: ${category}`);
    where.push("category = ?");
    vals.push(category);
  }
  if (provider) {
    if (!/^[a-z0-9_-]{1,64}$/.test(provider)) throw badRequest("Invalid provider filter");
    where.push("provider_id = ?");
    vals.push(provider);
  }
  if (exposed !== undefined && exposed !== "") {
    if (exposed !== "true" && exposed !== "false") throw badRequest("exposed must be true or false");
    where.push("exposed = ?");
    vals.push(exposed === "true" ? 1 : 0);
  }
  if (search) {
    const escaped = search.replace(/[%_\\]/g, (m) => `\\${m}`)
    where.push("(model_id LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')");
    vals.push(`%${escaped}%`, `%${escaped}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
   const sql = `SELECT provider_id, model_id, display_name, category, input_modalities, output_modalities, context_window, max_output_tokens, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, supports_tools, supports_parallel_tools, supports_vision, supports_reasoning, reasoning_type, reasoning_levels, family, lab, open_weights, knowledge_cutoff, catalog_source, exposed, enabled, fetched_at FROM models ${whereSql} ORDER BY provider_id ASC, model_id ASC LIMIT ? OFFSET ?`;
  vals.push(limit, offset);
  const res = await c.env.DB.prepare(sql).bind(...vals).all();
  const totalRes = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM models ${whereSql}`).bind(...vals.slice(0, -2)).first<{ cnt: number }>();
  const parsed = (res.results ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    input_modalities: r.input_modalities ? JSON.parse(r.input_modalities as string) : null,
    output_modalities: r.output_modalities ? JSON.parse(r.output_modalities as string) : null,
    reasoning_levels: r.reasoning_levels ? JSON.parse(r.reasoning_levels as string) : null,
  }));
  return c.json({ data: parsed, total: totalRes?.cnt ?? 0, limit, offset });
});

adminModelsRoute.post("/models/bulk", async (c) => {
  requireAdmin(c as never);
  const body = await c.req.json().catch(() => null) as { modelIds?: Array<{ provider_id: string; model_id: string }>; exposed?: boolean; enabled?: boolean } | null;
  if (!body || !Array.isArray(body.modelIds) || body.modelIds.length === 0) throw badRequest("modelIds array required");
  if (body.modelIds.length > 500) throw badRequest("modelIds exceeds limit of 500");
  if (body.exposed === undefined && body.enabled === undefined) throw badRequest("exposed or enabled required");
  const now = Date.now();
  // Validate and check duplicates before mutating anything — makes the operation effectively atomic.
  const seen = new Set<string>()
  for (const { provider_id, model_id } of body.modelIds) {
    if (!provider_id || !model_id) throw badRequest("Each modelId requires provider_id and model_id");
    const key = `${provider_id}::${model_id}`
    if (seen.has(key)) throw badRequest(`Duplicate entry in request: ${model_id} (${provider_id})`);
    seen.add(key)
    if (body.exposed === true) {
      const dup = await c.env.DB.prepare(
        "SELECT provider_id FROM models WHERE model_id = ? AND exposed = 1 AND provider_id != ? LIMIT 1",
      ).bind(model_id, provider_id).first<{ provider_id: string }>();
      if (dup) throw conflict(`Model ${model_id} already exposed by provider ${dup.provider_id}`);
    }
  }
  // Also detect duplicate model_id exposed twice within the same batch (different providers).
  if (body.exposed === true) {
    const modelIds = body.modelIds.map((m) => m.model_id)
    const freq = new Map<string, number>()
    for (const id of modelIds) freq.set(id, (freq.get(id) ?? 0) + 1)
    for (const [id, count] of freq) if (count > 1) throw conflict(`Model ${id} appears multiple times in bulk expose`)
  }
  const stmts: D1PreparedStatement[] = []
  for (const { provider_id, model_id } of body.modelIds) {
    const sets: string[] = []
    const vals: unknown[] = []
    if (typeof body.exposed === "boolean") {
      sets.push("exposed = ?")
      vals.push(body.exposed ? 1 : 0)
    }
    if (typeof body.enabled === "boolean") {
      sets.push("enabled = ?")
      vals.push(body.enabled ? 1 : 0)
    }
    sets.push("updated_at = ?")
    vals.push(now, provider_id, model_id)
    stmts.push(c.env.DB.prepare(`UPDATE models SET ${sets.join(", ")} WHERE provider_id = ? AND model_id = ?`).bind(...vals))
  }
  // D1 batch is not a true transaction, but duplicate checks above guarantee no partial conflict.
  // Use batch for fewer roundtrips; fallback to sequential for test fakes without batch.
  const batchFn = (c.env.DB as unknown as { batch?: (stmts: D1PreparedStatement[]) => Promise<unknown> }).batch
  let updated = 0
  if (typeof batchFn === "function" && stmts.length > 0) {
    const results = (await batchFn.call(c.env.DB, stmts)) as Array<{ meta: { changes: number } }>
    for (const r of results) if (r.meta.changes > 0) updated++
  } else {
    for (const s of stmts) {
      const res = await s.run()
      if ((res as unknown as { meta: { changes: number } }).meta.changes > 0) updated++
    }
  }
  return c.json({ updated });
});
