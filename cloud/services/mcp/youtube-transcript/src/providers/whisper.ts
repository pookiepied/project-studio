import {
  AUDIO_FETCH_TIMEOUT_MS,
  DEFAULT_STT_MODEL,
  STT_MAX_FILE_BYTES,
  STT_REQUEST_TIMEOUT_MS,
} from "../constants";
import { Env } from "../env";
import { logger } from "../logger";

export interface TranscribeParams {
  audioUrl: string;
  env: Env;
  language?: string | null;
}

interface SttResponse {
  text?: string;
}

export async function transcribeAudio(
  params: TranscribeParams
): Promise<string | null> {
  const { audioUrl, env, language } = params;

  const isBound = !!env.AI && !!env.STT_PROVIDER_NAME;
  const isStandalone = !!env.STT_PROVIDER_URL && !!env.STT_PROVIDER_API_KEY;

  if (!isBound && !isStandalone) {
    logger.warn("whisper: STT not configured — set STT_PROVIDER_NAME (bound) or STT_PROVIDER_URL + STT_PROVIDER_API_KEY (standalone)");
    return null;
  }

  const audioBlob = await fetchAudioBlob(audioUrl);
  if (!audioBlob) return null;

  const ext = getAudioExt(audioBlob.type);
  const model = env.STT_MODEL ?? DEFAULT_STT_MODEL;

  if (isBound) {
    return transcribeViaBoundWorker(audioBlob, ext, model, env, language);
  }

  return transcribeStandalone(audioBlob, ext, model, env, language);
}

// ---------------------------------------------------------------------------
// Bound mode — routes through the AI worker, which uses its own provider key.
// The AI worker validates the provider against its model catalog, applies rate
// limits, and records usage exactly as it does for any other transcription request.
// ---------------------------------------------------------------------------

async function transcribeViaBoundWorker(
  audioBlob: Blob,
  ext: string,
  model: string,
  env: Env,
  language?: string | null
): Promise<string | null> {
  // Construct the qualified model ID expected by the AI worker: provider:model
  const qualifiedModel = `${env.STT_PROVIDER_NAME}:${model}`;

  const form = new FormData();
  form.append("file", audioBlob, `audio.${ext}`);
  form.append("provider_name", env.STT_PROVIDER_NAME!);
  form.append("model", qualifiedModel);
  if (language) form.append("language", language);

  logger.info("whisper: routing through AI worker (bound mode)", {
    provider: env.STT_PROVIDER_NAME,
    model: qualifiedModel,
    size: audioBlob.size,
  });

  let response: Response;
  try {
    // Service binding calls use http://internal/<path>.
    // AbortSignal is not supported on service binding fetches.
    response = await env.AI!.fetch("http://internal/internal/stt", {
      method: "POST",
      body: form,
    });
  } catch (e) {
    logger.error("whisper: AI worker STT call failed", { error: String(e) });
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error("whisper: AI worker STT error", {
      status: response.status,
      body: body.slice(0, 200),
    });
    return null;
  }

  const result = (await response.json()) as SttResponse;
  const text = result.text?.trim() ?? null;
  logger.info("whisper: bound transcription complete", { chars: text?.length ?? 0 });
  return text;
}

// ---------------------------------------------------------------------------
// Standalone mode — calls any OpenAI-compatible STT endpoint directly.
// ---------------------------------------------------------------------------

async function transcribeStandalone(
  audioBlob: Blob,
  ext: string,
  model: string,
  env: Env,
  language?: string | null
): Promise<string | null> {
  const baseUrl = env.STT_PROVIDER_URL!.replace(/\/$/, "");
  const apiKey = env.STT_PROVIDER_API_KEY!;

  const form = new FormData();
  form.append("file", audioBlob, `audio.${ext}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (language) form.append("language", language);

  logger.info("whisper: calling STT provider directly (standalone mode)", {
    baseUrl,
    model,
    size: audioBlob.size,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(STT_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    logger.error("whisper: standalone STT request failed", { error: String(e) });
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error("whisper: standalone STT API error", {
      status: response.status,
      body: body.slice(0, 300),
    });
    return null;
  }

  const result = (await response.json()) as SttResponse;
  const text = result.text?.trim() ?? null;
  logger.info("whisper: standalone transcription complete", { chars: text?.length ?? 0 });
  return text;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fetchAudioBlob(audioUrl: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(audioUrl, {
      signal: AbortSignal.timeout(AUDIO_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    logger.error("whisper: audio fetch failed", { error: String(e) });
    return null;
  }

  if (!response.ok) {
    logger.error("whisper: audio fetch HTTP error", { status: response.status });
    return null;
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength && parseInt(rawLength, 10) > STT_MAX_FILE_BYTES) {
    logger.warn("whisper: audio exceeds 25 MB limit before buffering", {
      bytes: rawLength,
    });
    return null;
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (e) {
    logger.error("whisper: failed to buffer audio", { error: String(e) });
    return null;
  }

  if (blob.size > STT_MAX_FILE_BYTES) {
    logger.warn("whisper: buffered audio exceeds 25 MB limit", { bytes: blob.size });
    return null;
  }

  return blob;
}

function getAudioExt(mimeType: string): string {
  if (
    mimeType.includes("mp4") ||
    mimeType.includes("aac") ||
    mimeType.includes("m4a")
  ) {
    return "mp4";
  }
  return "webm";
}
