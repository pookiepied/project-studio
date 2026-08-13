/**
 * POST /v1/images/generations — OpenAI image API, gateway proxy
 * Supports text→image (fal, openai/dall-e, google/imagen) and text→video via same path.
 * Uses same gating: findExposedModel → decrypt → proxy, but respects category.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { findExposedModel, getProvider, getCredential } from "../../lib/db.ts";
import { decrypt } from "../../lib/encryption.ts";
import { badRequest, modelNotFound, modelNotExposed, providerNotConfigured } from "../../lib/errors.ts";
import { requireGatewayBearer } from "../../middleware/auth.ts";
import { checkRateLimit } from "../../lib/ratelimit.ts";
import { logger } from "../../lib/logger.ts";

export const imagesRoute = new Hono<{ Bindings: Env }>();

imagesRoute.post("/images/generations", async (c) => {
  const auth = c.req.header("authorization");
  const verified = await requireGatewayBearer(c.env.DB, auth ?? null, c.env.ENVIRONMENT);
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE gateway_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), verified.keyId).run());
  }
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.model !== "string") throw badRequest("Missing model");
  const modelId = body.model as string;
  const model = await findExposedModel(c.env.DB, modelId);
  if (!model) {
    const any = await c.env.DB.prepare("SELECT 1 FROM models WHERE model_id = ?").bind(modelId).first();
    if (any) throw modelNotExposed(modelId);
    throw modelNotFound(modelId);
  }
  if (model.category !== "image" && model.category !== "video") {
    // allow text models that produce images (gateway treats vision hybrid as text), but log
    logger.info("images: non-image category", { model: modelId, category: model.category });
  }
  const provider = await getProvider(c.env.DB, model.provider_id);
  if (!provider || !provider.enabled) throw providerNotConfigured(model.provider_id);
  const cred = await getCredential(c.env.DB, provider.id);
  if (!cred) throw providerNotConfigured(provider.id);
  if (!c.env.CREDENTIAL_ENCRYPTION_KEY) throw providerNotConfigured(provider.id);
  const apiKey = await decrypt(cred.encrypted_key, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("images generations", { provider: provider.id, model: modelId });
  const clean = provider.base_url.replace(/\/$/, "");
  const url = clean.endsWith("/v1") ? `${clean}/images/generations` : `${clean}/v1/images/generations`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: c.req.raw.signal as AbortSignal,
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
});
