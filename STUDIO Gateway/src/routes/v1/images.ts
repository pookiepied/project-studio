/**
 * POST /v1/images/generations — Unified image generation.
 * Each provider folder (openai, fal, third-party) owns its image transport;
 * this route only resolves model/provider and delegates to the runtime.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest, notImplemented } from "../../lib/errors.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { logger } from "../../observability/logger.ts";
import { resolveModelAndProvider, getApiKey } from "../../gateway/resolver.ts";
import { getProviderRuntime } from "../../providers/registry.ts";
import { markRoutingComplete } from "../../observability/request.ts";

export const imagesRoute = new Hono<{ Bindings: Env }>();

imagesRoute.post("/images/generations", async (c) => {
  await authorizeGateway(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  markRoutingComplete(c as never);
  if (model.category === "video") throw notImplemented("Video generation has a separate provider contract and is not exposed through /images/generations");
  if (model.category !== "image") throw badRequest(`Model ${modelId} is not an image generation model`);
  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("images generations", { provider: provider.id, model: modelId });

  const runtime = await getProviderRuntime(provider.id, provider.protocol as never);
  if (!runtime.generateImage) throw notImplemented(`Image generation is not implemented for provider ${provider.id}`);

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) throw badRequest("prompt is required for image generation");

  const modelDef = rowToModelDef(model);

  return runtime.generateImage({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
    apiKey,
    prompt,
    body: body as Record<string, unknown>,
    signal: c.req.raw.signal as AbortSignal,
  });
});
