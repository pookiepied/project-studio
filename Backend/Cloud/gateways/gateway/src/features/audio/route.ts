import { Hono } from "hono";
import { requireModel } from "@/domain/catalog/resolveModel";
import { Capability } from "@/domain/models/capabilities";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { GatewayError } from "@/platform/errors";
import { getProvider } from "@/providers/registry";
import { parseSpeechRequest, parseTranscriptionRequest } from "./request";

export const audioRoute = new Hono<{ Bindings: GatewayEnv }>();

audioRoute.post("/transcriptions", async (c) => {
  const body = await parseTranscriptionRequest(c.req.raw);
  const model = requireModel(body.model, Capability.Transcription);
  const provider = getProvider(model.provider);
  if (!provider?.transcribe) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support transcription.`);
  }

  const response = await provider.transcribe(
    { ...body, model: model.providerModelId },
    { env: c.env, request: c.req.raw, executionCtx: c.executionCtx }
  );
  return c.json(response);
});

audioRoute.post("/speech", async (c) => {
  const body = await parseSpeechRequest(c.req.raw);
  const model = requireModel(body.model, Capability.Speech);
  const provider = getProvider(model.provider);
  if (!provider?.speak) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support speech.`);
  }

  const response = await provider.speak(
    { ...body, model: model.providerModelId },
    { env: c.env, request: c.req.raw, executionCtx: c.executionCtx }
  );
  return new Response(response.audio, {
    headers: {
      "content-type": response.mediaType,
      "cache-control": "no-store"
    }
  });
});
