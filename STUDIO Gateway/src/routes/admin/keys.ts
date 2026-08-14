/**
 * Admin - gateway keys (unified URL consumers use)
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { generateGatewayKey, hashGatewayKeyAsync } from "../../infra/encryption.ts";
import { badRequest } from "../../lib/errors.ts";

export const adminKeysRoute = new Hono<{ Bindings: Env }>();

adminKeysRoute.get("/keys", async (c) => {
  requireAdmin(c as never);
  const rows = await c.env.DB.prepare(
    "SELECT id, name, key_prefix, scopes, rate_limit_rpm, enabled, created_at, last_used_at FROM gateway_keys ORDER BY created_at DESC",
  ).all();
  return c.json({ data: rows.results });
});

adminKeysRoute.post("/keys", async (c) => {
  requireAdmin(c as never);
  const body = await c.req.json().catch(() => null) as { name?: string; rateLimitRpm?: number } | null;
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
    "INSERT INTO gateway_keys (id, name, key_hash, key_prefix, rate_limit_rpm, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
  )
    .bind(id, name, hash, prefix, rpm, now)
    .run();
  // Return plain key once
  return c.json({ id, name, key: raw, prefix, rate_limit_rpm: rpm }, 201);
});

adminKeysRoute.delete("/keys/:id", async (c) => {
  requireAdmin(c as never);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM gateway_keys WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
