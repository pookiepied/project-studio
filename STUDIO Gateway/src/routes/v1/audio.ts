/**
 * Audio routes — unified via provider runtime.
 * Each provider (openai, elevenlabs, fal, third-party) owns its audio transport.
 */

import { Hono } from "hono";
import type { Env } from "../../index.ts";
import { badRequest, notImplemented } from "../../lib/errors.ts";
import { authorizeGateway } from "../../middleware/gatewayAuth.ts";
import { rowToModelDef } from "../../infra/db.ts";
import { logger } from "../../observability/logger.ts";
import { resolveModelAndProvider, getApiKey } from "../../gateway/resolver.ts";
import { getProviderRuntime } from "../../providers/registry.ts";

export const audioRoute = new Hono<{ Bindings: Env }>();

async function proxyAudio(c: import("hono").Context<{ Bindings: Env }>, endpoint: string) {
  await authorizeGateway(c);
  let modelId: string | undefined;
  const ct = c.req.header("content-type") ?? "";
  let body: Record<string, unknown> | null = null;
  let form: FormData | null = null;
  if (ct.includes("multipart/form-data")) {
    form = await c.req.formData();
    const v = form.get("model");
    modelId = typeof v === "string" ? v : undefined;
  } else {
    body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    modelId = body?.model as string | undefined;
  }
  if (!modelId) throw badRequest("Missing model");
  const { model, provider } = await resolveModelAndProvider(c.env.DB, modelId);
  if (endpoint === "/audio/speech" && model.category !== "speech") throw badRequest(`Model ${modelId} is not a speech model`);
  if (endpoint !== "/audio/speech" && model.category !== "transcription") throw badRequest(`Model ${modelId} is not a transcription model`);
  if (endpoint === "/audio/translations") throw notImplemented("Translation is not exposed as a separate operation — use transcription with language options");

  const apiKey = await getApiKey(c.env.DB, provider.id, c.env.CREDENTIAL_ENCRYPTION_KEY);
  logger.info("audio", { provider: provider.id, model: modelId, endpoint });

  const runtime = await getProviderRuntime(provider.id, provider.protocol as never);
  const modelDef = rowToModelDef(model);

  if (endpoint === "/audio/speech") {
    if (!runtime.generateSpeech) throw notImplemented(`Provider ${provider.id} does not support speech`);
    const input = typeof body?.input === "string" ? body.input : "";
    if (!input) throw badRequest("input is required for speech");
    return runtime.generateSpeech({
      model: modelDef,
      provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
      apiKey,
      input,
      voice: typeof body?.voice === "string" ? body.voice : undefined,
      responseFormat: typeof body?.response_format === "string" ? body.response_format : undefined,
      body: (body ?? {}) as Record<string, unknown>,
      signal: c.req.raw.signal as AbortSignal,
    });
  }

  // transcriptions — multipart
  if (!form) throw badRequest("multipart/form-data is required for transcription");
  if (!runtime.transcribe) throw notImplemented(`Provider ${provider.id} does not support transcription`);
  return runtime.transcribe({
    model: modelDef,
    provider: { id: provider.id, baseUrl: provider.base_url, protocol: provider.protocol as never },
    apiKey,
    form,
    signal: c.req.raw.signal as AbortSignal,
  });
}

audioRoute.post("/audio/speech", (c) => proxyAudio(c, "/audio/speech"));
audioRoute.post("/audio/transcriptions", (c) => proxyAudio(c, "/audio/transcriptions"));
audioRoute.post("/audio/translations", (c) => proxyAudio(c, "/audio/translations"));
