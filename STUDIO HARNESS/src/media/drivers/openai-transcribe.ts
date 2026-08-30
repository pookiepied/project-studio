import { requestDirect, HttpError } from "../../net/http.js";
import { MediaError } from "../../contracts/media.js";
import type { UrlAuthor } from "../../net/destination.js";
import { multipartBody } from "../multipart.js";
import type { DriverEndpoint, TranscriptionDriver, TranscriptionSlotInput } from "./types.js";

/**
 * OpenAI's transcription endpoint: one multipart upload in, one text out.
 *
 * The webview's MediaRecorder produces `audio/webm;codecs=opus`; Whisper and
 * the transcribe models accept the container by its mime type, so what was
 * recorded is what is uploaded - no transcode on the way through. The
 * response is JSON `{ "text": "..." }`.
 *
 * The credential travels in the `Authorization` header and nowhere else.
 */

/** 120 seconds: a couple of spoken minutes transcribe well inside this. */
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/** 25 MB: the endpoints' own ceiling for a single upload. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const AUTHOR: UrlAuthor = "user";

interface OpenAiTranscribeBody {
  readonly text?: string;
}

interface OpenAiAudioError {
  readonly error?: { readonly message?: unknown };
}

export const openaiTranscribe: TranscriptionDriver = async (
  input: TranscriptionSlotInput,
  endpoint: DriverEndpoint,
) => {
  if (input.audio.length > MAX_AUDIO_BYTES) {
    throw new MediaError("audio-too-large", "The recording is over 25 MB; dictate in shorter takes.");
  }

  const body = multipartBody([
    { name: "model", value: input.modelId },
    {
      name: "file",
      value: input.audio,
      filename: "dictation.webm",
      contentType: input.mimeType,
    },
  ]);

  const answered = await requestDirect({
    url: `${endpoint.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
    author: AUTHOR,
    method: "POST",
    headers: {
      "content-type": body.contentType,
      ...(endpoint.credential === undefined
        ? {}
        : { authorization: `Bearer ${endpoint.credential}` }),
    },
    body: body.bytes,
    timeoutMs: endpoint.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw new MediaError("provider-refused", describeRefusal(error), {
      retryable: error instanceof HttpError && error.retryable,
    });
  });

  if (answered.status >= 400) {
    const detail = refusalDetail(answered.body);
    throw new MediaError(
      "provider-refused",
      detail === undefined
        ? `The transcription provider answered ${answered.status} with no explanation.`
        : `The transcription provider refused the request: ${detail}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError(
      "provider-refused",
      "The transcription provider's answer was not readable JSON.",
    );
  }
  const text =
    typeof parsed === "object" && parsed !== null
      ? (parsed as OpenAiTranscribeBody).text
      : undefined;
  if (typeof text !== "string") {
    throw new MediaError("provider-refused", "The transcription provider returned no text.");
  }
  return { text };
};

function refusalDetail(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const error = (parsed as OpenAiAudioError).error;
    if (error !== undefined && typeof error.message === "string") return error.message;
    return undefined;
  } catch {
    return undefined;
  }
}

function describeRefusal(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  return "The transcription provider could not be reached.";
}
