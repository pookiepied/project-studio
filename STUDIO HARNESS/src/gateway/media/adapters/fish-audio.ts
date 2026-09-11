import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import { multipartBody } from "../multipart.js";
import type { DriverEndpoint, SpeechSlotInput, TranscriptionSlotInput } from "../drivers/types.js";
import type { MediaAdapter } from "./types.js";

/**
 * Fish Audio: speech, with a voice-cloning lineage, and a beta
 * transcription endpoint, on one Bearer key. Checked against docs.fish.audio
 * on 2026-09-11.
 *
 * - `POST /tts` - JSON `{ text, format, reference_id? }`, with the model
 *   named in a `model` header rather than the body, which is Fish's quirk.
 *   Raw audio bytes back in the format asked for; mp3 here. The slot's
 *   voice is a Fish `reference_id`; without one, Fish's default voice.
 * - `POST /asr` - multipart with `audio`, JSON `{ text }` back. The docs say
 *   base64 JSON is not taken, so the upload is the one shape.
 *
 * The base URL a connection carries is `https://api.fish.audio/v1`.
 */

const AUTHOR: UrlAuthor = "user";
const SPEECH_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 300_000;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const SPEECH_MIME = "audio/mpeg";

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function bearer(endpoint: DriverEndpoint): Record<string, string> {
  return endpoint.credential === undefined ? {} : { authorization: `Bearer ${endpoint.credential}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return undefined;
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.detail === "string") return parsed.detail;
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
      ? `Fish Audio answered ${String(status)} to the ${what} request with no explanation.`
      : `Fish Audio refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `Fish Audio could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  const answered = await requestBinary({
    url: `${origin(endpoint)}/tts`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": "application/json", model: input.modelId, ...bearer(endpoint) },
    body: JSON.stringify({
      text: input.text,
      format: "mp3",
      ...(input.voiceId === undefined ? {} : { reference_id: input.voiceId }),
    }),
    timeoutMs: endpoint.timeoutMs ?? SPEECH_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("speech", error);
  });
  if (answered.status >= 400) throw refused("speech", answered.status, answered.bytes.toString("utf8"));
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "Fish Audio returned no audio.");
  }
  return { audio: answered.bytes.toString("base64"), mimeType: SPEECH_MIME };
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  if (input.audio.length > MAX_AUDIO_BYTES) {
    throw new MediaError("audio-too-large", "The recording is over 100 MB; transcribe it in parts.");
  }
  const body = multipartBody([
    { name: "audio", value: input.audio, filename: "recording", contentType: input.mimeType },
  ]);
  const answered = await requestDirect({
    url: `${origin(endpoint)}/asr`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": body.contentType, ...bearer(endpoint) },
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
    throw new MediaError("provider-refused", "Fish Audio's transcription was not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.text !== "string") {
    throw new MediaError("provider-refused", "Fish Audio's transcription carried no text.");
  }
  return { text: parsed.text };
}

export const fishAudioMedia: MediaAdapter = {
  protocol: "fish-audio",
  speak,
  transcribe,
};
