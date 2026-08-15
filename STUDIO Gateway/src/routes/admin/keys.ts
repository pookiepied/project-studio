/**
 * Admin - gateway keys (unified URL consumers use)
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { generateGatewayKey, hashGatewayKeyAsync } from "../../infra/encryption.ts";
import { badRequest, notFound } from "../../lib/errors.ts";

export const adminKeysRoute = new Hono<{ Bindings: Env }>();

adminKeysRoute.get("/keys", async (c) => {
  requireAdmin(c as never);
  const rows = await c.env.DB.prepare(
    "SELECT id, name, description, key_prefix, scopes, rate_limit_rpm, enabled, created_at, last_used_at FROM gateway_keys ORDER BY created_at DESC",
  ).all();
  return c.json({ data: rows.results });
});

adminKeysRoute.post("/keys", async (c) => {
  requireAdmin(c as never);
  const body = await c.req.json().catch(() => null) as { name?: string; description?: string; rateLimitRpm?: number } | null;
  const name = body?.name?.trim();
  if (!name) throw badRequest("name required");
  const rpm = body?.rateLimitRpm ?? 60;
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 100_000) throw badRequest("rateLimitRpm must be an integer between 1 and 100000");
  const raw = generateGatewayKey();
  const hash = await hashGatewayKeyAsync(raw);
  const id = crypto.randomUUID();
  const prefix = raw.slice(0, 12);
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO gateway_keys (id, name, description, key_hash, key_prefix, rate_limit_rpm, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, name, body?.description?.trim() || null, hash, prefix, rpm, now)
    .run();
  // Return plain key once
  return c.json({ id, name, key: raw, prefix, rate_limit_rpm: rpm }, 201);
});

adminKeysRoute.patch("/keys/:id", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM gateway_keys WHERE id = ?").bind(id).first();
  if (!existing) throw notFound("Gateway token not found");
  const body = await c.req.json().catch(() => null) as { name?: string; description?: string; enabled?: boolean; rateLimitRpm?: number } | null;
  if (!body) throw badRequest("Invalid body");
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim()) { sets.push("name = ?"); values.push(body.name.trim()); }
  if (typeof body.description === "string") { sets.push("description = ?"); values.push(body.description.trim() || null); }
  if (typeof body.enabled === "boolean") { sets.push("enabled = ?"); values.push(body.enabled ? 1 : 0); }
  if (typeof body.rateLimitRpm === "number" && Number.isInteger(body.rateLimitRpm) && body.rateLimitRpm >= 1 && body.rateLimitRpm <= 100_000) { sets.push("rate_limit_rpm = ?"); values.push(body.rateLimitRpm); }
  if (!sets.length) throw badRequest("No fields to update");
  values.push(id);
  await c.env.DB.prepare(`UPDATE gateway_keys SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
  return c.json({ ok: true });
});

adminKeysRoute.post("/keys/:id/rotate", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, name, rate_limit_rpm FROM gateway_keys WHERE id = ?").bind(id).first<{ id: string; name: string; rate_limit_rpm: number }>();
  if (!existing) throw notFound("Gateway token not found");
  const raw = generateGatewayKey();
  const hash = await hashGatewayKeyAsync(raw);
  const prefix = raw.slice(0, 12);
  await c.env.DB.prepare("UPDATE gateway_keys SET key_hash = ?, key_prefix = ? WHERE id = ?").bind(hash, prefix, id).run();
  return c.json({ id, name: existing.name, key: raw, prefix, rate_limit_rpm: existing.rate_limit_rpm });
});

adminKeysRoute.delete("/keys/:id", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM gateway_keys WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
