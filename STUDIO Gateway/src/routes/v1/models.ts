/**
 * GET /v1/models - OpenAI-compatible model list
 * Returns ONLY exposed models (admin has explicitly allowed). Discovery populates all, this filters.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { listExposedModels } from "../../lib/db.ts";
import { verifyGatewayBearer } from "../../middleware/auth.ts";
import { checkRateLimit } from "../../lib/ratelimit.ts";
import { logger } from "../../lib/logger.ts";

export const modelsRoute = new Hono<{ Bindings: Env }>();

modelsRoute.get("/models", async (c) => {
  const authHeader = c.req.header("authorization");
  const verified = await verifyGatewayBearer(c.env.DB, authHeader ?? null);
  const keyCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM gateway_keys WHERE enabled=1").first<{ cnt: number }>();
  const hasKeys = (keyCount?.cnt ?? 0) > 0;
  if (hasKeys && !verified) {
    return c.json({ error: { message: "Unauthorized - valid Bearer sk-gw_ required", type: "unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gateway_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), verified.keyId).run());
  }
  const rows = await listExposedModels(c.env.DB);
  logger.info("list models", { count: rows.length, gatewayKeyId: verified?.keyId });
  const data = rows.map((r) => ({
    id: r.model_id,
    object: "model" as const,
    created: r.fetched_at ? Math.floor(r.fetched_at / 1000) : Math.floor(Date.now() / 1000),
    owned_by: r.provider_id,
  }));
  return c.json({ object: "list" as const, data });
});

modelsRoute.get("/models/:id", async (c) => {
  const authHeader = c.req.header("authorization");
  const verified = await verifyGatewayBearer(c.env.DB, authHeader ?? null);
  const keyCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM gateway_keys WHERE enabled=1").first<{ cnt: number }>();
  const hasKeys = (keyCount?.cnt ?? 0) > 0;
  if (hasKeys && !verified) {
    return c.json({ error: { message: "Unauthorized", type: "unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
  }
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM models WHERE model_id = ? AND exposed = 1")
    .bind(id)
    .first();
  if (!row) return c.json({ error: { message: `Model not found: ${id}`, type: "not_found", code: "MODEL_NOT_FOUND" } }, 404);
  const r = row as unknown as import("../../lib/db.ts").ModelRow;
  return c.json({
    id: r.model_id,
    object: "model" as const,
    created: r.fetched_at ? Math.floor(r.fetched_at / 1000) : Math.floor(Date.now() / 1000),
    owned_by: r.provider_id,
  });
});
