import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint, SpeechSlotInput, TranscriptionSlotInput } from "../drivers/types.js";
import { openrouterMediaModels } from "../../catalog/openrouter-media.js";
import { observeOperation } from "../../../observability/operation.js";
import { audioFormat } from "../audio-format.js";
import { pagesOfTranscript, transcriptionInstruction } from "./document-transcript.js";
import type {
  DocumentReadingInput,
  DocumentReadingResult,
  Generation,
  ImageGenerationInput,
  MediaAdapter,
  MediaBytes,
  PollOutcome,
  VideoGenerationInput,
} from "./types.js";

/**
 * OpenRouter's media wire: speech, transcription, images and video on the
 * one key a person already holds for chat.
 *
 * Four endpoints under one base URL, checked against OpenRouter's own API
 * reference on 2026-09-11:
 *
 * - `POST /audio/speech` — OpenAI-shaped; raw audio bytes back, `mp3` or
 *   `pcm`. Asked for mp3 so the result's type is a fact we chose.
 * - `POST /audio/transcriptions` — JSON with base64 audio and its format
 *   name (`wav`, `webm`, `mp3`...), `{ text }` back. The JSON body rather
 *   than multipart because JSON has no 25 MB cap and the format travels as
 *   a word rather than a filename extension we would have to invent.
 * - `POST /images` — synchronous, base64 inline as `b64_json` with a
 *   `media_type` beside it. No job id: the docs' own example took 94
 *   seconds, so the timeout is generous and a dropped connection loses the
 *   generation. Input images ride as `input_references` data URLs, which is
 *   reference-guided generation, not a masked edit.
 * - `POST /videos` — a job: `202` with an id, then `GET /videos/{id}`
 *   through pending, in_progress, completed, failed, cancelled, expired,
 *   then `GET /videos/{id}/content` for the bytes. No cancel endpoint is
 *   documented, so a Stop stops asking. The content route streams the
 *   upstream provider's file, so the download happens here, inside the
 *   poll that saw `completed`, and nothing above keeps a vendor URL.
 *
 * Documents, checked on 2026-09-22, ride `POST /chat/completions` as a
 * `file` content part - a data URL and a filename - beside the shared
 * transcription instruction. OpenRouter parses the file for the model:
 * natively when the model takes files, else through its own OCR engine
 * (`file-parser` plugin, Mistral OCR by default, billed to the OpenRouter
 * account per page). The parsed pages reach the model, and the model's
 * prose answer is cut into pages by the instruction's markers.
 *
 * The credential travels in the `Authorization` header and nowhere else.
 * The app name headers OpenRouter asks integrators for are sent so the
 * generations show in the person's own OpenRouter activity as Studio's.
 */

const AUTHOR: UrlAuthor = "user";

/** Two minutes for audio, four for an image that may take ninety seconds. */
const AUDIO_TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 240_000;
const POLL_TIMEOUT_MS = 30_000;
/** Ten minutes to pull a finished video down. */
const DOWNLOAD_TIMEOUT_MS = 600_000;

/** A generated image is a few megabytes; a video is not, and gets its own ceiling. */
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;

const SPEECH_MIME = "audio/mpeg";

const STUDIO_HEADERS: Readonly<Record<string, string>> = {
  "http-referer": "https://projectstudio.app",
  "x-title": "Project Studio",
};

function headersFor(endpoint: DriverEndpoint, json: boolean): Record<string, string> {
  return {
    ...STUDIO_HEADERS,
    ...(json ? { "content-type": "application/json" } : {}),
    ...(endpoint.credential === undefined ? {} : { authorization: `Bearer ${endpoint.credential}` }),
  };
}

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function dataUrl(image: MediaBytes): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

interface OpenRouterError {
  readonly error?: { readonly message?: unknown };
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const error = (parsed as OpenRouterError).error;
    return error !== undefined && typeof error.message === "string" ? error.message : undefined;
  } catch {
    return undefined;
  }
}

function refused(what: string, status: number, body: string): MediaError {
  const detail = refusalDetail(body);
  return new MediaError(
    "provider-refused",
    detail === undefined
      ? `OpenRouter answered ${String(status)} to the ${what} request with no explanation.`
      : `OpenRouter refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `OpenRouter could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Speech and transcription                                                    */
/* -------------------------------------------------------------------------- */

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  // Voices belong to the selected model. A universal fallback such as alloy
  // would fail again as soon as the person selected another provider's model.
  const voiceId = input.voiceId ?? await observeOperation("provider", "media.voice.resolve", async () => {
    const models = await openrouterMediaModels(endpoint.baseUrl);
    return models.find((model) => model.modelId === input.modelId)?.voiceIds?.[0];
  }, { protocol: "openrouter", modelId: input.modelId });
  const answered = await requestBinary({
    url: `${origin(endpoint)}/audio/speech`,
    author: AUTHOR,
    method: "POST",
    headers: headersFor(endpoint, true),
    body: JSON.stringify({
      model: input.modelId,
      input: input.text,
      ...(voiceId === undefined ? {} : { voice: voiceId }),
      response_format: "mp3",
    }),
    timeoutMs: endpoint.timeoutMs ?? AUDIO_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("speech", error);
  });
  if (answered.status >= 400) throw refused("speech", answered.status, answered.bytes.toString("utf8"));
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "OpenRouter returned no audio.");
  }
  return { audio: answered.bytes.toString("base64"), mimeType: SPEECH_MIME };
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  const answered = await requestDirect({
    url: `${origin(endpoint)}/audio/transcriptions`,
    author: AUTHOR,
    method: "POST",
    headers: headersFor(endpoint, true),
    body: JSON.stringify({
      model: input.modelId,
      input_audio: {
        data: Buffer.from(input.audio).toString("base64"),
        format: audioFormat(input.mimeType),
      },
    }),
    timeoutMs: endpoint.timeoutMs ?? AUDIO_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("transcription", error);
  });
  if (answered.status >= 400) throw refused("transcription", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "OpenRouter's transcription was not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.text !== "string") {
    throw new MediaError("provider-refused", "OpenRouter's transcription carried no text.");
  }
  return { text: parsed.text };
}

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

async function generateImage(
  input: ImageGenerationInput,
  endpoint: DriverEndpoint,
): Promise<Generation> {
  const references = (input.inputImages ?? []).map((image) => ({
    type: "image_url",
    image_url: { url: dataUrl(image) },
  }));
  const body = {
    model: input.modelId,
    prompt: input.prompt,
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.aspectRatio === undefined ? {} : { aspect_ratio: input.aspectRatio }),
    ...(input.count === undefined ? {} : { n: input.count }),
    ...(references.length === 0 ? {} : { input_references: references }),
  };

  const result = (async (): Promise<readonly MediaBytes[]> => {
    const answered = await requestDirect({
      url: `${origin(endpoint)}/images`,
      author: AUTHOR,
      method: "POST",
      headers: headersFor(endpoint, true),
      body: JSON.stringify(body),
      timeoutMs: endpoint.timeoutMs ?? IMAGE_TIMEOUT_MS,
      maxBytes: IMAGE_MAX_BYTES,
    }).catch((error: unknown) => {
      throw unreachable("image", error);
    });
    if (answered.status >= 400) throw refused("image", answered.status, answered.body);

    let parsed: unknown;
    try {
      parsed = JSON.parse(answered.body);
    } catch {
      throw new MediaError("provider-refused", "OpenRouter's image answer was not JSON.");
    }
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    const images: MediaBytes[] = [];
    for (const item of data) {
      if (!isRecord(item) || typeof item.b64_json !== "string") continue;
      images.push({
        bytes: new Uint8Array(Buffer.from(item.b64_json, "base64")),
        mimeType: typeof item.media_type === "string" ? item.media_type : "image/png",
      });
    }
    if (images.length === 0) {
      throw new MediaError("provider-refused", "OpenRouter's image answer carried no image.");
    }
    return images;
  })();

  return { shape: "sync", result };
}

/* -------------------------------------------------------------------------- */
/* Video                                                                       */
/* -------------------------------------------------------------------------- */

async function generateVideo(
  input: VideoGenerationInput,
  endpoint: DriverEndpoint,
): Promise<Generation> {
  const body = {
    model: input.modelId,
    prompt: input.prompt,
    ...(input.durationSeconds === undefined ? {} : { duration: input.durationSeconds }),
    ...(input.aspectRatio === undefined ? {} : { aspect_ratio: input.aspectRatio }),
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
    ...(input.image === undefined
      ? {}
      : {
          frame_images: [
            { type: "image_url", image_url: { url: dataUrl(input.image) }, frame_type: "first_frame" },
          ],
        }),
  };

  const submitted = await requestDirect({
    url: `${origin(endpoint)}/videos`,
    author: AUTHOR,
    method: "POST",
    headers: headersFor(endpoint, true),
    body: JSON.stringify(body),
    timeoutMs: endpoint.timeoutMs ?? POLL_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("video", error);
  });
  if (submitted.status >= 400) throw refused("video", submitted.status, submitted.body);

  let parsed: unknown;
  try {
    parsed = JSON.parse(submitted.body);
  } catch {
    throw new MediaError("provider-refused", "OpenRouter's video answer was not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.id !== "string") {
    throw new MediaError("provider-refused", "OpenRouter's video answer carried no job id.");
  }
  const jobId = parsed.id;

  const poll = async (): Promise<PollOutcome> => {
    const answered = await requestDirect({
      url: `${origin(endpoint)}/videos/${encodeURIComponent(jobId)}`,
      author: AUTHOR,
      method: "GET",
      headers: headersFor(endpoint, false),
      timeoutMs: POLL_TIMEOUT_MS,
    }).catch((error: unknown) => {
      throw unreachable("video status", error);
    });
    if (answered.status >= 400) throw refused("video status", answered.status, answered.body);

    let status: unknown;
    try {
      status = JSON.parse(answered.body);
    } catch {
      return { state: "failed", message: "OpenRouter's video status was not JSON." };
    }
    const state = isRecord(status) && typeof status.status === "string" ? status.status : "";
    switch (state) {
      case "pending":
        return { state: "queued" };
      case "in_progress":
        return { state: "running" };
      case "completed":
        return { state: "done", outputs: [await download(jobId, endpoint)] };
      case "failed":
      case "cancelled":
      case "expired": {
        const message =
          isRecord(status) && typeof status.error === "string" && status.error.length > 0
            ? status.error
            : `OpenRouter reported the video as ${state}.`;
        return { state: "failed", message };
      }
      default:
        return { state: "failed", message: `OpenRouter reported an unknown video state "${state}".` };
    }
  };

  return { shape: "poll", job: { id: jobId, poll } };
}

/** The finished bytes, through OpenRouter's own content route. */
async function download(jobId: string, endpoint: DriverEndpoint): Promise<MediaBytes> {
  const answered = await requestBinary({
    url: `${origin(endpoint)}/videos/${encodeURIComponent(jobId)}/content`,
    author: AUTHOR,
    method: "GET",
    headers: headersFor(endpoint, false),
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: VIDEO_MAX_BYTES,
  }).catch((error: unknown) => {
    throw unreachable("video download", error);
  });
  if (answered.status >= 400) {
    throw refused("video download", answered.status, answered.bytes.toString("utf8"));
  }
  if (answered.bytes.length === 0) {
    throw new MediaError("provider-refused", "OpenRouter's finished video was empty.");
  }
  const contentType = answered.headers["content-type"]?.split(";")[0]?.trim();
  return {
    bytes: new Uint8Array(answered.bytes),
    mimeType: contentType !== undefined && contentType.length > 0 ? contentType : "video/mp4",
  };
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const DOCUMENT_TIMEOUT_MS = 300_000;
const DOCUMENT_MAX_ANSWER_BYTES = 64 * 1024 * 1024;
/** Mistral's OCR ceiling, which is what OpenRouter's default parser is. */
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** The assistant's text from the first choice; a string or text parts, as vendors vary. */
function completionText(completion: unknown): string {
  if (!isRecord(completion) || !Array.isArray(completion.choices)) return "";
  const first: unknown = completion.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  const content = first.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: unknown): part is Record<string, unknown> => isRecord(part) && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

async function readDocument(
  input: DocumentReadingInput,
  endpoint: DriverEndpoint,
): Promise<DocumentReadingResult> {
  if (input.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new MediaError("document-too-large", "The document is over 50 MB, the parser's ceiling for one file.");
  }
  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const part = input.mimeType.startsWith("image/")
    ? { type: "image_url", image_url: { url: dataUrl } }
    : { type: "file", file: { filename: input.fileName, file_data: dataUrl } };
  const answered = await requestDirect({
    url: `${origin(endpoint)}/chat/completions`,
    author: AUTHOR,
    method: "POST",
    headers: headersFor(endpoint, true),
    body: JSON.stringify({
      model: input.modelId,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: transcriptionInstruction(input.pages) }, part],
        },
      ],
    }),
    timeoutMs: endpoint.timeoutMs ?? DOCUMENT_TIMEOUT_MS,
    maxBytes: DOCUMENT_MAX_ANSWER_BYTES,
  }).catch((error: unknown) => {
    throw unreachable("document", error);
  });
  if (answered.status >= 400) throw refused("document", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "OpenRouter's document answer was not JSON.");
  }
  const pages = pagesOfTranscript(completionText(parsed), input.pages);
  if (pages.length === 0) {
    throw new MediaError("provider-refused", "OpenRouter's document answer carried no text.");
  }
  return { pages };
}

export const openrouterMedia: MediaAdapter = {
  protocol: "openrouter",
  speak,
  transcribe,
  generateImage,
  generateVideo,
  readDocument,
};
