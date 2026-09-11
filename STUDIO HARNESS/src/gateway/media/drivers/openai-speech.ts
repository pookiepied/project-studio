import { requestBinary, HttpError } from "../../../net/http.js";
import { MediaError } from "../../../contracts/media.js";
import type { UrlAuthor } from "../../../net/destination.js";
import type { DriverEndpoint, SpeechDriver, SpeechSlotInput } from "./types.js";

/**
 * OpenAI's text-to-speech endpoint: one JSON request in, one audio file out.
 *
 * The response is bytes, which is exactly why `requestBinary` exists - the
 * utf8 reader would hand back mojibake and call it a voice. `mp3` is asked
 * for by name so the result's mime type is a fact we chose, not a header we
 * guessed at.
 *
 * The credential travels in the `Authorization` header and nowhere else: not
 * in a log line, not in an error message, not in the result.
 */

/** 120 seconds: a long paragraph renders slower than a page fetch, but not much. */
const SPEECH_TIMEOUT_MS = 120_000;

const RESPONSE_FORMAT = "mp3";
const RESPONSE_MIME = "audio/mpeg";

const AUTHOR: UrlAuthor = "user";

interface OpenAiSpeechBody {
  readonly model: string;
  readonly input: string;
  readonly voice: string;
  readonly response_format: string;
}

interface OpenAiAudioError {
  readonly error?: { readonly message?: unknown };
}

export const openaiSpeech: SpeechDriver = async (
  input: SpeechSlotInput,
  endpoint: DriverEndpoint,
) => {
  const body: OpenAiSpeechBody = {
    model: input.modelId,
    input: input.text,
    voice: input.voiceId ?? "alloy",
    response_format: RESPONSE_FORMAT,
  };

  const answered = await requestBinary({
    url: `${endpoint.baseUrl.replace(/\/$/, "")}/audio/speech`,
    author: AUTHOR,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(endpoint.credential === undefined
        ? {}
        : { authorization: `Bearer ${endpoint.credential}` }),
    },
    body: JSON.stringify(body),
    timeoutMs: endpoint.timeoutMs ?? SPEECH_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw new MediaError("provider-refused", describeRefusal(error), {
      retryable: error instanceof HttpError && error.retryable,
    });
  });

  if (answered.status >= 400) {
    // The provider's sentence, minus anything that might echo the key: the
    // body is read as text for the message, never echoed whole.
    const detail = refusalDetail(answered.bytes);
    throw new MediaError(
      "provider-refused",
      detail === undefined
        ? `The speech provider answered ${answered.status} with no explanation.`
        : `The speech provider refused the request: ${detail}`,
    );
  }

  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "The speech provider returned no audio.");
  }

  return { audio: answered.bytes.toString("base64"), mimeType: RESPONSE_MIME };
};

/** The one JSON probe a refusal earns: read for the sentence, drop the rest. */
function refusalDetail(bytes: Buffer): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
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
  return "The speech provider could not be reached.";
}
