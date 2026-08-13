/**
 * Audio routes — TTS, STT, transcription all via gateway proxy.
 * POST /v1/audio/speech, /v1/audio/transcriptions, /v1/audio/translations
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { findExposedModel, getProvider, getCredential } from "../../lib/db.ts";
import { decrypt } from "../../lib/encryption.ts";
import { badRequest, modelNotFound, modelNotExposed, providerNotConfigured } from "../../lib/errors.ts";
import { requireGatewayBearer } from "../../middleware/auth.ts";
import { checkRateLimit } from "../../lib/ratelimit.ts";
import { logger } from "../../lib/logger.ts";

export const audioRoute = new Hono<{ Bindings: Env }>();

async function proxyAudio(c: import("hono").Context<{ Bindings: Env }>, endpoint: string) {
  const auth = c.req.header("authorization");
  const verified = await requireGatewayBearer(c.env.DB, auth ?? null, c.env.ENVIRONMENT);
  if (verified) {
    const rl = await checkRateLimit(c.env.DB, verified.keyId, verified.rpm);
    if (!rl.allowed) return c.json({ error: { message: "Rate limit exceeded", type: "rate_limited", code: "RATE_LIMITED" } }, 429);
  }
  // audio may be multipart/form-data; parse model from form or json
  let modelId: string | undefined;
  const ct = c.req.header("content-type") ?? "";
  let body: unknown;
  let bodyInit: BodyInit | null = null;
  let passthroughHeaders: Record<string, string> = {};
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    modelId = form.get("model") as string | undefined;
    bodyInit = form as unknown as BodyInit;
    // let fetch set boundary
  } else {
    body = await c.req.json().catch(() => null);
    modelId = (body as Record<string, unknown>)?.model as string | undefined;
    bodyInit = body ? JSON.stringify(body) : null;
    passthroughHeaders["content-type"] = "application/json";
  }
  if (!modelId) throw badRequest("Missing model");
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
  if (!c.env.CREDENTIAL_ENCRYPTION_KEY) throw providerNotConfigured(provider.id);
  const apiKey = await decrypt(cred.encrypted_key, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("audio", { provider: provider.id, model: modelId, endpoint });
  const clean = provider.base_url.replace(/\/$/, "");
  const url = clean.endsWith("/v1") ? `${clean}${endpoint}` : `${clean}/v1${endpoint}`;
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, ...passthroughHeaders };
  // For elevenlabs multipart, use xi-api-key header instead
  if (provider.id === "elevenlabs") {
    headers["xi-api-key"] = apiKey;
    delete headers.authorization;
  }
  const upstream = await fetch(url, {
    method: "POST",
    headers,
    body: bodyInit,
    signal: c.req.raw.signal as AbortSignal,
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}

audioRoute.post("/audio/speech", (c) => proxyAudio(c, "/audio/speech"));
audioRoute.post("/audio/transcriptions", (c) => proxyAudio(c, "/audio/transcriptions"));
audioRoute.post("/audio/translations", (c) => proxyAudio(c, "/audio/translations"));
