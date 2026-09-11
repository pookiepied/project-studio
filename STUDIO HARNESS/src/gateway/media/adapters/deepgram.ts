import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint, SpeechSlotInput, TranscriptionSlotInput } from "../drivers/types.js";
import type { MediaAdapter } from "./types.js";

/**
 * Deepgram: the cleanest transcription wire in the research, and Aura for
 * speech, on one key in `Authorization: Token <key>`. Checked against
 * developers.deepgram.com on 2026-09-11.
 *
 * - `POST /listen?model=<model>&smart_format=true` with the audio bytes as
 *   the body and their type as the content type; the transcript is at
 *   `results.channels[0].alternatives[0].transcript`. Files to 2 GB.
 * - `POST /speak?model=<model>&encoding=mp3` with `{ text }`; mp3 bytes back.
 *
 * The base URL a connection carries is `https://api.deepgram.com/v1`.
 */

const AUTHOR: UrlAuthor = "user";
const TRANSCRIBE_TIMEOUT_MS = 600_000;
const SPEECH_TIMEOUT_MS = 120_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const SPEECH_MIME = "audio/mpeg";

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function keyHeader(endpoint: DriverEndpoint): Record<string, string> {
  return endpoint.credential === undefined ? {} : { authorization: `Token ${endpoint.credential}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return undefined;
    for (const key of ["err_msg", "message", "error"]) {
      const value = parsed[key];
      if (typeof value === "string") return value;
    }
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
      ? `Deepgram answered ${String(status)} to the ${what} request with no explanation.`
      : `Deepgram refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `Deepgram could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  if (input.audio.length > MAX_AUDIO_BYTES) {
    throw new MediaError("audio-too-large", "The recording is over 2 GB; transcribe it in parts.");
  }
  const query = new URLSearchParams({ model: input.modelId, smart_format: "true" });
  const answered = await requestDirect({
    url: `${origin(endpoint)}/listen?${query.toString()}`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": input.mimeType, ...keyHeader(endpoint) },
    body: input.audio,
    timeoutMs: endpoint.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("transcription", error);
  });
  if (answered.status >= 400) throw refused("transcription", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "Deepgram's transcription was not JSON.");
  }
  const text = transcriptOf(parsed);
  if (text === undefined) {
    throw new MediaError("provider-refused", "Deepgram's transcription carried no text.");
  }
  return { text };
}

/** `results.channels[0].alternatives[0].transcript`. */
function transcriptOf(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !isRecord(parsed.results) || !Array.isArray(parsed.results.channels)) return undefined;
  const channel: unknown = parsed.results.channels[0];
  if (!isRecord(channel) || !Array.isArray(channel.alternatives)) return undefined;
  const alternative: unknown = channel.alternatives[0];
  if (!isRecord(alternative) || typeof alternative.transcript !== "string") return undefined;
  return alternative.transcript;
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  // Aura names its voice in the model id (aura-2-thalia-en); a voice chosen
  // in the slot is that name, and outranks the model's own.
  const query = new URLSearchParams({ model: input.voiceId ?? input.modelId, encoding: "mp3" });
  const answered = await requestBinary({
    url: `${origin(endpoint)}/speak?${query.toString()}`,
    author: AUTHOR,
    method: "POST",
    headers: { "content-type": "application/json", ...keyHeader(endpoint) },
    body: JSON.stringify({ text: input.text }),
    timeoutMs: endpoint.timeoutMs ?? SPEECH_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("speech", error);
  });
  if (answered.status >= 400) throw refused("speech", answered.status, answered.bytes.toString("utf8"));
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "Deepgram returned no audio.");
  }
  return { audio: answered.bytes.toString("base64"), mimeType: SPEECH_MIME };
}

export const deepgramMedia: MediaAdapter = {
  protocol: "deepgram",
  transcribe,
  speak,
};
