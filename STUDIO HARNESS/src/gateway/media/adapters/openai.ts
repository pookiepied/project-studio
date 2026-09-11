import { HttpError, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import { openaiSpeech } from "../drivers/openai-speech.js";
import { openaiTranscribe } from "../drivers/openai-transcribe.js";
import type { DriverEndpoint } from "../drivers/types.js";
import type { Generation, ImageGenerationInput, MediaAdapter, MediaBytes } from "./types.js";

/**
 * OpenAI's media family: images, edits, speech and transcription on one key.
 *
 * The two audio drivers predate this file and are carried here as they
 * are - they already speak the endpoints, and the service's OpenAI-shaped
 * fallback for self-hosted language connections uses the same functions.
 * What this file adds is the image half, checked against OpenAI's API
 * reference on 2026-09-11:
 *
 * - `POST /images/generations` - JSON in, base64 back. GPT Image models
 *   return `b64_json` only; `url` mode is for the retired DALL-E models.
 *   "Complex prompts may take up to 2 minutes", so the timeout is generous.
 * - `POST /images/edits` - JSON in, with up to 16 input images as
 *   `images: [{ image_url: "data:..." }]`; the same base64 answer. This is
 *   what earns `imageEditing` for every GPT Image model.
 *
 * No video: the Sora-2 Videos API shuts down on 2026-09-24, and OpenAI is
 * an image and audio vendor here.
 */

const AUTHOR: UrlAuthor = "user";
const IMAGE_TIMEOUT_MS = 240_000;
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;

const FORMAT_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function headers(endpoint: DriverEndpoint): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(endpoint.credential === undefined ? {} : { authorization: `Bearer ${endpoint.credential}` }),
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

function dataUrl(image: MediaBytes): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

async function generateImage(
  input: ImageGenerationInput,
  endpoint: DriverEndpoint,
): Promise<Generation> {
  const editing = input.inputImages !== undefined && input.inputImages.length > 0;
  const body = {
    model: input.modelId,
    prompt: input.prompt,
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.count === undefined ? {} : { n: input.count }),
    ...(editing
      ? { images: (input.inputImages ?? []).map((image) => ({ image_url: dataUrl(image) })) }
      : {}),
  };

  const result = (async (): Promise<readonly MediaBytes[]> => {
    const answered = await requestDirect({
      url: `${origin(endpoint)}/images/${editing ? "edits" : "generations"}`,
      author: AUTHOR,
      method: "POST",
      headers: headers(endpoint),
      body: JSON.stringify(body),
      timeoutMs: endpoint.timeoutMs ?? IMAGE_TIMEOUT_MS,
      maxBytes: IMAGE_MAX_BYTES,
    }).catch((error: unknown) => {
      throw new MediaError(
        "provider-refused",
        error instanceof HttpError ? error.message : "OpenAI could not be reached for the image request.",
        { retryable: error instanceof HttpError && error.retryable },
      );
    });
    if (answered.status >= 400) {
      const detail = refusalDetail(answered.body);
      throw new MediaError(
        "provider-refused",
        detail === undefined
          ? `OpenAI answered ${String(answered.status)} to the image request with no explanation.`
          : `OpenAI refused the image request: ${detail}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(answered.body);
    } catch {
      throw new MediaError("provider-refused", "OpenAI's image answer was not JSON.");
    }
    const format =
      isRecord(parsed) && typeof parsed.output_format === "string" ? parsed.output_format : "png";
    const mimeType = FORMAT_MIME[format] ?? "image/png";
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    const images: MediaBytes[] = [];
    for (const item of data) {
      if (!isRecord(item) || typeof item.b64_json !== "string") continue;
      images.push({ bytes: new Uint8Array(Buffer.from(item.b64_json, "base64")), mimeType });
    }
    if (images.length === 0) {
      throw new MediaError("provider-refused", "OpenAI's image answer carried no image.");
    }
    return images;
  })();

  return { shape: "sync", result };
}

export const openaiMedia: MediaAdapter = {
  protocol: "openai",
  speak: openaiSpeech,
  transcribe: openaiTranscribe,
  generateImage,
};
