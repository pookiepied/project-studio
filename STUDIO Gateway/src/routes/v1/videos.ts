/**
 * POST /v1/videos/generations — Video generation via provider runtime.
 * Uses async job model where provider requires it (Fal queue, Google Veo), but exposes sync OpenAI-like response.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest, notImplemented } from "../../lib/errors.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { logger } from "../../observability/logger.ts";
import { resolveModelAndProvider, getApiKey } from "../../gateway/resolver.ts";
import { getProviderRuntime } from "../../providers/registry.ts";

export const videosRoute = new Hono<{ Bindings: Env }>();

videosRoute.post("/videos/generations", async (c) => {
  await authorizeGateway(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  if (model.category !== "video") throw badRequest(`Model ${modelId} is not a video generation model`);
  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("videos generations", { provider: provider.id, model: modelId });

  const runtime = await getProviderRuntime(provider.id, provider.protocol as never);
  if (!runtime.generateVideo) throw notImplemented(`Video generation is not implemented for provider ${provider.id}`);

  const prompt = typeof body.prompt === "string" ? body.prompt : (body as { input?: string }).input;
  if (!prompt || typeof prompt !== "string") throw badRequest("prompt is required for video generation");

  const modelDef = rowToModelDef(model);

  return runtime.generateVideo({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
    apiKey,
    prompt,
    body: body as Record<string, unknown>,
    signal: c.req.raw.signal as AbortSignal,
  });
});
