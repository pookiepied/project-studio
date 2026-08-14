/**
 * POST /v1/responses - OpenAI Responses API via unified runtime.
 * Uses Responses protocol for providers that expose it; openai supports both.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest, notImplemented } from "../../lib/errors.ts";
import { logger } from "../../observability/logger.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { resolveModelAndProvider, getApiKey, parseReasoning } from "../../gateway/resolver.ts";
import { getProviderRuntime } from "../../providers/registry.ts";
import { isProtocol } from "../../providers/types.ts";
import { isBudgetSupported } from "../../providers/shared/runtime.ts";

export const responsesRoute = new Hono<{ Bindings: Env }>();

responsesRoute.post("/responses", async (c) => {
  await authorizeGateway(c);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  if (model.category !== "text") throw badRequest(`Model ${modelId} is not a text generation model`);
  if (!isProtocol(provider.protocol)) throw notImplemented(`Provider ${provider.id} has no supported protocol`);
  const supportsResponses = provider.protocol === "openai-responses" || (provider.id === "openai" && provider.protocol === "openai-completions");
  if (!supportsResponses) throw notImplemented(`Provider ${provider.id} does not support the Responses API`);
  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("responses", { provider: provider.id, model: modelId });

  const runtime = await getProviderRuntime(provider.id, "openai-responses" as never);
  const modelDef = rowToModelDef(model);
  const reasoning = parseReasoning(body as Record<string, unknown>);
  if (reasoning?.mode === "budget" && !isBudgetSupported(provider.id)) {
    throw notImplemented(`Provider ${provider.id} does not support exact budget reasoning — use adaptive levels or a budget-capable provider`);
  }
  return runtime.chat({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: "openai-responses" as never },
    apiKey,
    body: body as Record<string, unknown>,
    signal: c.req.raw.signal as AbortSignal,
    reasoning,
  });
});
