/**
 * POST /v1/responses - OpenAI Responses API (for gpt-5/o-series)
 * Only for providers with openai-responses protocol.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { findExposedModel, getProvider, getCredential } from "../../lib/db.ts";
import { decrypt } from "../../lib/encryption.ts";
import { badRequest, modelNotFound, modelNotExposed, providerNotConfigured } from "../../lib/errors.ts";
import { logger } from "../../lib/logger.ts";
import { verifyGatewayBearer } from "../../middleware/auth.ts";
import { checkRateLimit } from "../../lib/ratelimit.ts";
import { getAdapter } from "../../providers/registry.ts";
import type { Protocol } from "../../providers/types.ts";

export const responsesRoute = new Hono<{ Bindings: Env }>();

responsesRoute.post("/responses", async (c) => {
  const authHeader = c.req.header("authorization");
  const verified = await verifyGatewayBearer(c.env.DB, authHeader ?? null);
  if (!verified) {
    const keyCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM gateway_keys WHERE enabled=1").first<{ cnt: number }>();
    if ((keyCount?.cnt ?? 0) > 0) {
      return c.json({ error: { message: "Unauthorized", type: "unauthorized", code: "UNAUTHORIZED" } }, 401);
    }
  } else {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gateway_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), verified.keyId).run());
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const model = await findExposedModel(c.env.DB, modelId);
  if (!model) {
    const any = await c.env.DB.prepare("SELECT 1 FROM models WHERE model_id = ?").bind(modelId).first();
    if (any) throw modelNotExposed(modelId);
    throw modelNotFound(modelId);
  }
  const provider = await getProvider(c.env.DB, model.provider_id);
  if (!provider || !provider.enabled) throw providerNotConfigured(model.provider_id);
  // Responses requires openai-responses protocol; if provider is openai-completions, passthrough to same adapter
  const protocol = provider.protocol as Protocol;
  if (protocol !== "openai-responses" && protocol !== "openai-completions") {
    throw badRequest(`Provider ${provider.id} does not support responses API`);
  }
  const cred = await getCredential(c.env.DB, provider.id);
  if (!cred) throw providerNotConfigured(provider.id);
  const apiKey = await decrypt(cred.encrypted_key, c.env.CREDENTIAL_ENCRYPTION_KEY!);
  logger.info("responses", { provider: provider.id, model: modelId });
  const adapter = getAdapter(protocol === "openai-responses" ? "openai-responses" : "openai-completions");
  const upstream = await adapter.chat(apiKey, provider.base_url, body, c.req.raw.signal as AbortSignal);
  return upstream;
});
