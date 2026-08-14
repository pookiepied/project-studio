/**
 * POST /v1/embeddings — OpenAI embeddings via AI SDK runtime.
 * Supports text, batch, dimensions via providerOptions, and multimodal where provider supports it.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest } from "../../lib/errors.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { logger } from "../../observability/logger.ts";
import { resolveModelAndProvider, getApiKey } from "../../gateway/resolver.ts";
import { getProviderRuntime } from "../../providers/registry.ts";

export const embeddingsRoute = new Hono<{ Bindings: Env }>();

embeddingsRoute.post("/embeddings", async (c) => {
  await authorizeGateway(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  if (model.category !== "embedding") throw badRequest(`Model ${modelId} is not an embedding model`);
  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("embeddings", { provider: provider.id, model: modelId });

  const runtime = await getProviderRuntime(provider.id, provider.protocol as never);
  if (!runtime.embed) throw badRequest(`Provider ${provider.id} does not support embeddings`);

  const input = (body.input as string | string[] | undefined) ?? (body as { inputs?: string | string[] }).inputs;
  if (!input) throw badRequest("input is required for embeddings");

  const modelDef = rowToModelDef(model);

  return runtime.embed({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
    apiKey,
    input,
    body: body as Record<string, unknown>,
    signal: c.req.raw.signal as AbortSignal,
  });
});
