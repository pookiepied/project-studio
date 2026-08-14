/**
 * GET /v1/models - OpenAI-compatible model list
 * Returns ONLY exposed models (admin has explicitly allowed). Discovery populates all, this filters.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { listExposedModels } from "../../infra/db.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { logger } from "../../observability/logger.ts";

export const modelsRoute = new Hono<{ Bindings: Env }>();

modelsRoute.get("/models", async (c) => {
  const verified = await authorizeGateway(c);
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

const getModelRoute = async (c: import("hono").Context<{ Bindings: Env }>) => {
  await authorizeGateway(c as unknown as import("hono").Context<{ Bindings: Env }>);
  const rawId = c.req.param("id") ?? c.req.param("*");
  const id = rawId ? decodeURIComponent(rawId) : "";
  if (!id) return c.json({ error: { message: "Model id is required", type: "invalid_request_error", code: "BAD_REQUEST" } }, 400);
  const row = await c.env.DB.prepare(
    "SELECT models.* FROM models JOIN providers ON providers.id = models.provider_id " +
      "WHERE models.model_id = ? AND models.exposed = 1 AND models.enabled = 1 AND providers.enabled = 1",
  )
    .bind(id)
    .first();
  if (!row) return c.json({ error: { message: `Model not found: ${id}`, type: "not_found", code: "MODEL_NOT_FOUND" } }, 404);
  const r = row as unknown as import("../../infra/db.ts").ModelRow;
  return c.json({
    id: r.model_id,
    object: "model" as const,
    created: r.fetched_at ? Math.floor(r.fetched_at / 1000) : Math.floor(Date.now() / 1000),
    owned_by: r.provider_id,
  });
};

modelsRoute.get("/models/:id", getModelRoute);
// Provider-scoped model ids may contain slashes, for example Fal model paths.
modelsRoute.get("/models/*", getModelRoute);
