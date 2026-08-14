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
  if (category) {
    where.push("category = ?");
    vals.push(category);
  }
  if (provider) {
    where.push("provider_id = ?");
    vals.push(provider);
  }
  if (exposed !== undefined && exposed !== "") {
    where.push("exposed = ?");
    vals.push(exposed === "true" ? 1 : 0);
  }
  if (search) {
    where.push("(model_id LIKE ? OR display_name LIKE ?)");
    vals.push(`%${search}%`, `%${search}%`);
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
  if (body.exposed === undefined && body.enabled === undefined) throw badRequest("exposed or enabled required");
  const now = Date.now();
  let updated = 0;
  for (const { provider_id, model_id } of body.modelIds) {
    if (!provider_id || !model_id) continue;
    if (body.exposed === true) {
      const dup = await c.env.DB.prepare(
        "SELECT provider_id FROM models WHERE model_id = ? AND exposed = 1 AND provider_id != ? LIMIT 1",
      ).bind(model_id, provider_id).first<{ provider_id: string }>();
      if (dup) throw conflict(`Model ${model_id} already exposed by provider ${dup.provider_id}`);
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof body.exposed === "boolean") {
      sets.push("exposed = ?");
      vals.push(body.exposed ? 1 : 0);
    }
    if (typeof body.enabled === "boolean") {
      sets.push("enabled = ?");
      vals.push(body.enabled ? 1 : 0);
    }
    sets.push("updated_at = ?");
    vals.push(now, provider_id, model_id);
    const res = await c.env.DB.prepare(`UPDATE models SET ${sets.join(", ")} WHERE provider_id = ? AND model_id = ?`).bind(...vals).run();
    if (res.meta.changes > 0) updated++;
  }
  return c.json({ updated });
});
