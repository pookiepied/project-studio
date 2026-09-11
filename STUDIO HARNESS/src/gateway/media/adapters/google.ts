import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint, SpeechSlotInput, TranscriptionSlotInput } from "../drivers/types.js";
import type {
  Generation,
  ImageGenerationInput,
  MediaAdapter,
  MediaBytes,
  PollOutcome,
  VideoGenerationInput,
} from "./types.js";

/**
 * Google's Gemini API media family: images, speech and transcription on the
 * Interactions API, and video through Veo's long-running operation. One
 * key, in the `x-goog-api-key` header, checked against ai.google.dev on
 * 2026-09-11.
 *
 * - `POST /interactions` with an image model - text input, and image
 *   inputs as base64 blocks for editing - answers `steps[].content[]` with
 *   `{ type: "image", data, mime_type }` inline. Synchronous.
 * - The same route with a TTS model and `response_format: { type: "audio" }`
 *   answers base64 audio that the docs decode as headerless 24 kHz 16-bit
 *   mono PCM. A WAV header is written in front of it here, so what leaves
 *   is a file every player understands.
 * - The same route with `gemini-3.5-transcribe` and an inline audio block
 *   (under 20 MB; the Files API is the path above it, not taken here)
 *   answers the transcript as text content.
 * - `POST /models/{model}:predictLongRunning` for Veo returns an operation
 *   name; `GET /{name}` until `done`; the video's URI is downloaded with the
 *   key attached, inside the poll that saw it, because Google keeps the
 *   file for two days and the harness keeps it for good. No cancel is
 *   documented for the operation; a Stop stops asking.
 */

const AUTHOR: UrlAuthor = "user";
const INTERACTION_TIMEOUT_MS = 240_000;
const POLL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
/** The Interactions API takes inline blocks under 20 MB in total. */
const MAX_INLINE_AUDIO_BYTES = 19 * 1024 * 1024;

const DEFAULT_VOICE = "Kore";
const PCM_SAMPLE_RATE = 24_000;

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function headers(endpoint: DriverEndpoint): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(endpoint.credential === undefined ? {} : { "x-goog-api-key": endpoint.credential }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed) || !isRecord(parsed.error)) return undefined;
    return typeof parsed.error.message === "string" ? parsed.error.message : undefined;
  } catch {
    return undefined;
  }
}

function refused(what: string, status: number, body: string): MediaError {
  const detail = refusalDetail(body);
  return new MediaError(
    "provider-refused",
    detail === undefined
      ? `Google answered ${String(status)} to the ${what} request with no explanation.`
      : `Google refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `Google could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

/** Every content block of every model_output step, in order. */
function outputBlocks(interaction: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(interaction) || !Array.isArray(interaction.steps)) return [];
  return interaction.steps.flatMap((step: unknown) => {
    if (!isRecord(step) || !Array.isArray(step.content)) return [];
    return step.content.filter(isRecord);
  });
}

async function interact(body: unknown, what: string, endpoint: DriverEndpoint, timeoutMs: number): Promise<unknown> {
  const answered = await requestDirect({
    url: `${origin(endpoint)}/interactions`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify(body),
    timeoutMs: endpoint.timeoutMs ?? timeoutMs,
    maxBytes: IMAGE_MAX_BYTES,
  }).catch((error: unknown) => {
    throw unreachable(what, error);
  });
  if (answered.status >= 400) throw refused(what, answered.status, answered.body);
  try {
    return JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", `Google's ${what} answer was not JSON.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Speech and transcription                                                    */
/* -------------------------------------------------------------------------- */

/** A RIFF/WAVE header for 16-bit mono PCM, so raw samples become a file. */
function wavOf(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  const interaction = await interact(
    {
      model: input.modelId,
      input: input.text,
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: input.voiceId ?? DEFAULT_VOICE }] },
    },
    "speech",
    endpoint,
    INTERACTION_TIMEOUT_MS,
  );
  const audio = outputBlocks(interaction).find(
    (block) => block.type === "audio" && typeof block.data === "string",
  );
  if (audio === undefined) {
    throw new MediaError("provider-refused", "Google returned no audio.");
  }
  const bytes = Buffer.from(audio.data as string, "base64");
  const mime = typeof audio.mime_type === "string" ? audio.mime_type : "";
  // Anything that already has a container travels as it is; the documented
  // default - headerless PCM - is given its header.
  if (mime.length > 0 && mime !== "audio/l16" && mime !== "audio/pcm") {
    return { audio: bytes.toString("base64"), mimeType: mime === "audio/mp3" ? "audio/mpeg" : mime };
  }
  const rate = typeof audio.sample_rate === "number" ? audio.sample_rate : PCM_SAMPLE_RATE;
  return { audio: wavOf(bytes, rate).toString("base64"), mimeType: "audio/wav" };
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  if (input.audio.length > MAX_INLINE_AUDIO_BYTES) {
    throw new MediaError("audio-too-large", "The recording is over 19 MB; transcribe it in parts.");
  }
  const interaction = await interact(
    {
      model: input.modelId,
      input: [
        {
          type: "audio",
          data: Buffer.from(input.audio).toString("base64"),
          mime_type: input.mimeType.split(";")[0]?.trim() ?? input.mimeType,
        },
      ],
    },
    "transcription",
    endpoint,
    INTERACTION_TIMEOUT_MS,
  );
  const text = outputBlocks(interaction)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
  if (text.length === 0) {
    throw new MediaError("provider-refused", "Google's transcription carried no text.");
  }
  return { text };
}

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

async function generateImage(input: ImageGenerationInput, endpoint: DriverEndpoint): Promise<Generation> {
  const body = {
    model: input.modelId,
    input: [
      { type: "text", text: input.prompt },
      ...(input.inputImages ?? []).map((image) => ({
        type: "image",
        mime_type: image.mimeType,
        data: Buffer.from(image.bytes).toString("base64"),
      })),
    ],
    ...(input.aspectRatio === undefined
      ? {}
      : { response_format: { type: "image", aspect_ratio: input.aspectRatio } }),
  };
  const result = (async (): Promise<readonly MediaBytes[]> => {
    const interaction = await interact(body, "image", endpoint, INTERACTION_TIMEOUT_MS);
    const images = outputBlocks(interaction)
      .filter((block) => block.type === "image" && typeof block.data === "string")
      .map((block) => ({
        bytes: new Uint8Array(Buffer.from(block.data as string, "base64")),
        mimeType: typeof block.mime_type === "string" ? block.mime_type : "image/png",
      }));
    if (images.length === 0) {
      throw new MediaError("provider-refused", "Google's image answer carried no image.");
    }
    return images;
  })();
  return { shape: "sync", result };
}

/* -------------------------------------------------------------------------- */
/* Video                                                                       */
/* -------------------------------------------------------------------------- */

async function generateVideo(input: VideoGenerationInput, endpoint: DriverEndpoint): Promise<Generation> {
  const body = {
    instances: [
      {
        prompt: input.prompt,
        ...(input.image === undefined
          ? {}
          : {
              image: {
                inlineData: {
                  mimeType: input.image.mimeType,
                  data: Buffer.from(input.image.bytes).toString("base64"),
                },
              },
            }),
      },
    ],
    parameters: {
      ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
      ...(input.durationSeconds === undefined ? {} : { durationSeconds: String(input.durationSeconds) }),
      ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
    },
  };

  const submitted = await requestDirect({
    url: `${origin(endpoint)}/models/${encodeURIComponent(input.modelId)}:predictLongRunning`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify(body),
    timeoutMs: endpoint.timeoutMs ?? POLL_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("video", error);
  });
  if (submitted.status >= 400) throw refused("video", submitted.status, submitted.body);

  let operation: unknown;
  try {
    operation = JSON.parse(submitted.body);
  } catch {
    throw new MediaError("provider-refused", "Google's video answer was not JSON.");
  }
  if (!isRecord(operation) || typeof operation.name !== "string" || operation.name.length === 0) {
    throw new MediaError("provider-refused", "Google's video answer carried no operation name.");
  }
  const name = operation.name;

  const poll = async (): Promise<PollOutcome> => {
    const answered = await requestDirect({
      url: `${origin(endpoint)}/${name}`,
      author: AUTHOR,
      method: "GET",
      headers: headers(endpoint),
      timeoutMs: POLL_TIMEOUT_MS,
    }).catch((error: unknown) => {
      throw unreachable("video status", error);
    });
    if (answered.status >= 400) throw refused("video status", answered.status, answered.body);
    let status: unknown;
    try {
      status = JSON.parse(answered.body);
    } catch {
      return { state: "failed", message: "Google's video status was not JSON." };
    }
    if (!isRecord(status) || status.done !== true) return { state: "running" };
    if (isRecord(status.error)) {
      const message = typeof status.error.message === "string" ? status.error.message : "Google reported an error.";
      return { state: "failed", message };
    }
    const uri = videoUri(status);
    if (uri === undefined) {
      return { state: "failed", message: "Google finished the video without a file to download." };
    }
    return { state: "done", outputs: [await download(uri, endpoint)] };
  };

  return { shape: "poll", job: { id: name, poll } };
}

/** `.response.generateVideoResponse.generatedSamples[0].video.uri`, as the docs read it. */
function videoUri(status: Record<string, unknown>): string | undefined {
  const response = status.response;
  if (!isRecord(response)) return undefined;
  const generated = response.generateVideoResponse;
  if (!isRecord(generated) || !Array.isArray(generated.generatedSamples)) return undefined;
  const first: unknown = generated.generatedSamples[0];
  if (!isRecord(first) || !isRecord(first.video)) return undefined;
  return typeof first.video.uri === "string" && first.video.uri.length > 0 ? first.video.uri : undefined;
}

async function download(uri: string, endpoint: DriverEndpoint): Promise<MediaBytes> {
  const answered = await requestBinary({
    url: uri,
    author: AUTHOR,
    method: "GET",
    headers: endpoint.credential === undefined ? {} : { "x-goog-api-key": endpoint.credential },
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: VIDEO_MAX_BYTES,
  }).catch((error: unknown) => {
    throw unreachable("video download", error);
  });
  if (answered.status >= 400) {
    throw refused("video download", answered.status, answered.bytes.toString("utf8"));
  }
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "Google's finished video was empty.");
  }
  const contentType = answered.headers["content-type"]?.split(";")[0]?.trim();
  return {
    bytes: new Uint8Array(answered.bytes),
    mimeType: contentType !== undefined && contentType.startsWith("video/") ? contentType : "video/mp4",
  };
}

export const googleMedia: MediaAdapter = {
  protocol: "google",
  speak,
  transcribe,
  generateImage,
  generateVideo,
};
