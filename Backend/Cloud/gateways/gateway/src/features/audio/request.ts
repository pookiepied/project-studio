import type { SpeechRequest, TranscriptionRequest } from "@/domain/contracts";
import { decodeBase64 } from "@/platform/encoding/base64";
import { GatewayError } from "@/platform/errors";

export async function parseTranscriptionRequest(request: Request): Promise<TranscriptionRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartTranscription(await request.formData());
  }

  const body = (await request.json()) as Partial<TranscriptionRequest> & { audio?: string };
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!body.audio || typeof body.audio !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "JSON transcription requests must include base64 audio.");
  }

  return { ...body, model: body.model, audio: decodeBase64(body.audio) };
}

export async function parseSpeechRequest(request: Request): Promise<SpeechRequest> {
  const body = (await request.json()) as Partial<SpeechRequest>;
  if (!body.model || typeof body.model !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include a model string.");
  }
  if (!body.input || typeof body.input !== "string") {
    throw new GatewayError("VALIDATION_ERROR", "Request body must include input text.");
  }

  return {
    ...body,
    model: body.model,
    input: body.input,
    voice: body.voice ?? "alloy"
  };
}

async function parseMultipartTranscription(form: FormData): Promise<TranscriptionRequest> {
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
