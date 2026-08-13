/**
 * POST /v1/chat/completions - OpenAI-compatible chat
 * Dispaches via adapter registry - each adapter handles translation.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { findExposedModel, getProvider, getCredential } from "../../lib/db.ts";
import { decrypt } from "../../lib/encryption.ts";
import { badRequest, modelNotFound, modelNotExposed, providerNotConfigured } from "../../lib/errors.ts";
import { logger } from "../../lib/logger.ts";
import { requireGatewayBearer } from "../../middleware/auth.ts";
import { checkRateLimit } from "../../lib/ratelimit.ts";
import { getProviderAdapter } from "../../providers/registry.ts";

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post("/chat/completions", async (c) => {
  const authHeader = c.req.header("authorization");
  const verified = await requireGatewayBearer(c.env.DB, authHeader ?? null, c.env.ENVIRONMENT);
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) {
      return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
    }
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gateway_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), verified.keyId).run());
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");

  const modelId: string = body.model;
  const model = await findExposedModel(c.env.DB, modelId);
  if (!model) {
    const any = await c.env.DB.prepare("SELECT 1 FROM models WHERE model_id = ?").bind(modelId).first();
    if (any) throw modelNotExposed(modelId);
    throw modelNotFound(modelId);
  }

  const provider = await getProvider(c.env.DB, model.provider_id);
  if (!provider || !provider.enabled) throw providerNotConfigured(model.provider_id);

  const cred = await getCredential(c.env.DB, provider.id);
  if (!cred) throw providerNotConfigured(provider.id);

  const keyBase64 = c.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyBase64) throw providerNotConfigured(provider.id);
  const apiKey = await decrypt(cred.encrypted_key, keyBase64);

  const providerId = provider.id;
  const baseUrl = provider.base_url;
  const stream = body.stream === true;

  logger.info("chat completions", { provider: providerId, model: modelId, stream });

  const adapter = getProviderAdapter(providerId);
  const upstream = await adapter.chat(apiKey, baseUrl, body, c.req.raw.signal as AbortSignal);

  // Adapter already returns OpenAI-compatible response (translated if needed)
  return upstream;
});
