/**
 * Admin routes - providers
 * No UI yet; curl-able. All under /admin, guarded by x-admin-token if ADMIN_TOKEN set.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { badRequest, notFound } from "../../lib/errors.ts";

export const adminProvidersRoute = new Hono<{ Bindings: Env }>();

adminProvidersRoute.get("/providers", async (c) => {
  requireAdmin(c as never);
  const rows = await c.env.DB.prepare("SELECT * FROM providers ORDER BY id ASC").all();
  return c.json({ data: rows.results });
});

adminProvidersRoute.get("/providers/:id", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first();
  if (!row) throw notFound(`Provider ${id} not found`);
  const models = await c.env.DB.prepare(
    "SELECT model_id, display_name, category, input_modalities, output_modalities, context_window, max_output_tokens, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write, supports_tools, supports_parallel_tools, supports_vision, supports_reasoning, reasoning_type, reasoning_levels, exposed, enabled, fetched_at FROM models WHERE provider_id = ? ORDER BY model_id ASC",
  )
    .bind(id)
    .all();
  // Parse JSON fields for admin UI
  const parsed = (models.results ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    input_modalities: r.input_modalities ? JSON.parse(r.input_modalities as string) : null,
    output_modalities: r.output_modalities ? JSON.parse(r.output_modalities as string) : null,
    reasoning_levels: r.reasoning_levels ? JSON.parse(r.reasoning_levels as string) : null,
  }));
  return c.json({ provider: row, models: parsed });
});

adminProvidersRoute.patch("/providers/:id", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as { enabled?: boolean; base_url?: string } | null;
  if (!body) throw badRequest("Invalid body");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.enabled === "boolean") {
    sets.push("enabled = ?");
    vals.push(body.enabled ? 1 : 0);
  }
  if (typeof body.base_url === "string") {
    sets.push("base_url = ?");
    vals.push(body.base_url);
  }
  if (sets.length === 0) throw badRequest("No fields to update");
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  await c.env.DB.prepare(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

// Toggle model exposure - admin selects what gateway exposes
adminProvidersRoute.patch("/providers/:id/models/:modelId", async (c) => {
  requireAdmin(c as never);
  const { id, modelId } = c.req.param();
  const body = await c.req.json().catch(() => null) as { exposed?: boolean; enabled?: boolean } | null;
  if (!body) throw badRequest("Invalid body");
  const row = await c.env.DB.prepare("SELECT 1 FROM models WHERE provider_id = ? AND model_id = ?").bind(id, modelId).first();
  if (!row) throw notFound(`Model ${modelId} not found for ${id}`);
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
  if (sets.length === 0) throw badRequest("No fields");
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id, modelId);
  await c.env.DB.prepare(`UPDATE models SET ${sets.join(", ")} WHERE provider_id = ? AND model_id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});
