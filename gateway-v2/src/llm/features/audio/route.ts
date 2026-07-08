import { Hono } from "hono";
import { Capability } from "../../../core/capabilities";
import { GatewayError, toErrorResponse } from "../../../core/errors";
import { providers } from "../../../core/registry";
import type { SpeechRequest, TranscriptionRequest } from "../../../core/types";
import type { GatewayEnv } from "../../../system/infrastructure/cloudflare/env";
import { getServedCatalog } from "../../discovery/catalog";

export const audioRoute = new Hono<{ Bindings: GatewayEnv }>();

audioRoute.post("/transcriptions", async (c) => {
  try {
    const body = await readTranscriptionRequest(c.req.raw);
    const model = await requireModel(c.env, body.model, Capability.Transcription);
    const provider = providers.find((candidate) => candidate.id === model.provider);
    if (!provider?.transcribe) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support transcription.`);
    }

    const response = await provider.transcribe(
      { ...body, model: model.providerModelId },
      {
        env: c.env,
        request: c.req.raw,
        executionCtx: c.executionCtx
      }
    );

    return c.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
});

audioRoute.post("/speech", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<SpeechRequest>;
    if (!body.model || typeof body.model !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
    }
    if (!body.input || typeof body.input !== "string") {
      throw new GatewayError("VALIDATION_ERROR", "Request body must include input text.");
    }

    const model = await requireModel(c.env, body.model, Capability.Speech);
    const provider = providers.find((candidate) => candidate.id === model.provider);
    if (!provider?.speak) {
      throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Provider ${model.provider} does not support speech.`);
    }

    const response = await provider.speak(
      {
        ...body,
        model: model.providerModelId,
        input: body.input,
        voice: body.voice ?? "alloy"
      },
      {
        env: c.env,
        request: c.req.raw,
        executionCtx: c.executionCtx
      }
    );

    return new Response(response.audio, {
      headers: {
        "content-type": response.mediaType,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

async function readTranscriptionRequest(request: Request): Promise<TranscriptionRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const model = form.get("model");
    if (!(file instanceof File)) {
      throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a file field.");
    }
    if (typeof model !== "string" || !model) {
      throw new GatewayError("VALIDATION_ERROR", "Multipart request must include a model field.");
    }

    return {
      model,
      audio: await file.arrayBuffer(),
      mediaType: file.type || undefined,
      language: stringValue(form.get("language")),
      prompt: stringValue(form.get("prompt")),
      temperature: numberValue(form.get("temperature")),
      timestampGranularities: form.getAll("timestamp_granularities[]").filter(isTimestampGranularity)
    };
  }

  const body = (await request.json()) as Partial<TranscriptionRequest> & { audio?: string };
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!body.audio || typeof body.audio !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "JSON transcription requests must include base64 audio.");
  }

  return {
    ...body,
    model: body.model,
    audio: base64ToArrayBuffer(body.audio)
  };
}

async function requireModel(env: GatewayEnv, requestedModel: string, capability: Capability) {
  const catalog = await getServedCatalog(env);
  const model = catalog.models.find(
    (candidate) => candidate.id === requestedModel || candidate.providerModelId === requestedModel
  );
  if (!model) {
    throw new GatewayError("MODEL_NOT_FOUND", `Model ${requestedModel} is not registered with the gateway.`);
  }
  if (!model.capabilities.modalities.includes(capability)) {
    throw new GatewayError("CAPABILITY_NOT_SUPPORTED", `Model ${model.id} does not support ${capability}.`);
  }
  return model;
}

function stringValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTimestampGranularity(value: FormDataEntryValue): value is "word" | "segment" {
  return value === "word" || value === "segment";
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
