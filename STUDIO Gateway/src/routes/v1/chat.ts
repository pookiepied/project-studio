/**
 * POST /v1/chat/completions - OpenAI-compatible chat
 * Dispaches via adapter registry - each adapter handles translation.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest, notImplemented } from "../../lib/errors.ts";
import { logger } from "../../observability/logger.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { getProviderRuntime } from "../../providers/registry.ts";
import { resolveModelAndProvider, getApiKey, parseReasoning, needsVisionFallback } from "../../gateway/resolver.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { isBudgetSupported } from "../../providers/shared/runtime.ts";

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post("/chat/completions", async (c) => {
  await authorizeGateway(c);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");

  const modelId: string = body.model;
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  if (model.category !== "text") throw badRequest(`Model ${modelId} is not a chat model`);
  if (provider.protocol === "openai-responses") throw notImplemented(`Provider ${provider.id} requires the Responses API`);
  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  const stream = body.stream === true;
  logger.info("chat completions", { provider: provider.id, model: modelId, stream });

  // Explicit vision guard: image attached to non-vision model → 400 with actionable guidance.
  // No auto-routing (Phase A); caller must use a vision model or POST /v1/documents/preprocess first.
  if (needsVisionFallback(model, body as Record<string, unknown>)) {
    logger.warn("chat vision fallback rejected", { provider: provider.id, model: modelId });
    throw badRequest(`Model ${modelId} does not support vision. Use a vision-capable model or POST /v1/documents/preprocess to extract text from images first.`);
  }
  const runtime = await getProviderRuntime(provider.id, provider.protocol as never);
  const modelDef = rowToModelDef(model);

  const reasoning = parseReasoning(body as Record<string, unknown>);
  if (reasoning?.mode === "budget" && !isBudgetSupported(provider.id)) {
    throw notImplemented(`Provider ${provider.id} does not support exact budget reasoning — use adaptive levels (low/medium/high) or a budget-capable provider (anthropic, google)`);
  }
  return runtime.chat({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
    apiKey,
    body: body as Record<string, unknown>,
    signal: c.req.raw.signal as AbortSignal,
    reasoning,
  });
});
