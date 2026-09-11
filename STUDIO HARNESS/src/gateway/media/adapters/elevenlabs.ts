import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import { multipartBody } from "../multipart.js";
import type { DriverEndpoint, SpeechSlotInput, TranscriptionSlotInput } from "../drivers/types.js";
import type { MediaAdapter } from "./types.js";

/**
 * ElevenLabs: speech, and transcription through Scribe, on one key.
 *
 * Two endpoints, checked against ElevenLabs's API reference on 2026-09-11:
 *
 * - `POST /text-to-speech/{voice_id}?output_format=mp3_44100_128` - JSON
 *   `{ text, model_id }` in, audio bytes back. The voice is part of the
 *   path, so a call needs one: the slot's voice when a person chose it,
 *   else ElevenLabs's own premade "Rachel", which every account has.
 * - `POST /speech-to-text` - multipart with `model_id` and `file`, JSON with
 *   `text` back. Scribe is the same key as the voices, which is why this
 *   is one adapter and not two connections.
 *
 * The key travels in the `xi-api-key` header and nowhere else.
 */

const AUTHOR: UrlAuthor = "user";
const SPEECH_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 300_000;
/** Scribe takes files to the gigabytes; a dictation is nowhere near, but a long recording may be. */
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const OUTPUT_FORMAT = "mp3_44100_128";
const SPEECH_MIME = "audio/mpeg";

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function keyHeader(endpoint: DriverEndpoint): Record<string, string> {
  return endpoint.credential === undefined ? {} : { "xi-api-key": endpoint.credential };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ElevenLabs answers refusals as `{ detail: { message } }` or `{ detail: "..." }`. */
function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return undefined;
    const detail = parsed.detail;
    if (typeof detail === "string") return detail;
    if (isRecord(detail) && typeof detail.message === "string") return detail.message;
    return undefined;
  } catch {
    return undefined;
  }
}

function refused(what: string, status: number, body: string): MediaError {
  const detail = refusalDetail(body);
  return new MediaError(
    "provider-refused",
    detail === undefined
      ? `ElevenLabs answered ${String(status)} to the ${what} request with no explanation.`
      : `ElevenLabs refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `ElevenLabs could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  const voice = encodeURIComponent(input.voiceId ?? DEFAULT_VOICE_ID);
  const answered = await requestBinary({
    url: `${origin(endpoint)}/text-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": "application/json", accept: SPEECH_MIME, ...keyHeader(endpoint) },
    body: JSON.stringify({ text: input.text, model_id: input.modelId }),
    timeoutMs: endpoint.timeoutMs ?? SPEECH_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("speech", error);
  });
  if (answered.status >= 400) throw refused("speech", answered.status, answered.bytes.toString("utf8"));
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "ElevenLabs returned no audio.");
  }
  return { audio: answered.bytes.toString("base64"), mimeType: SPEECH_MIME };
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  if (input.audio.length > MAX_AUDIO_BYTES) {
    throw new MediaError("audio-too-large", "The recording is over 500 MB; transcribe it in parts.");
  }
  const body = multipartBody([
    { name: "model_id", value: input.modelId },
    { name: "file", value: input.audio, filename: "recording", contentType: input.mimeType },
  ]);
  const answered = await requestDirect({
    url: `${origin(endpoint)}/speech-to-text`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": body.contentType, ...keyHeader(endpoint) },
    body: body.bytes,
    timeoutMs: endpoint.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("transcription", error);
  });
  if (answered.status >= 400) throw refused("transcription", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "ElevenLabs's transcription was not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.text !== "string") {
    throw new MediaError("provider-refused", "ElevenLabs's transcription carried no text.");
  }
  return { text: parsed.text };
}

export const elevenlabsMedia: MediaAdapter = {
  protocol: "elevenlabs",
  speak,
  transcribe,
};
