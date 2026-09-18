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
 * FAL's queue: the deepest hosted catalogue for video, behind one protocol.
 *
 * Every model on FAL is called the same way, checked against fal.ai's queue
 * reference on 2026-09-11: `POST {queue}/{model-id}` with the model's own
 * input, `Authorization: Key <key>` (the literal `Key ` prefix), answering
 * `request_id` with `status_url`, `response_url` and `cancel_url`. The
 * status walks IN_QUEUE, IN_PROGRESS, COMPLETED, with an `error` on a
 * COMPLETED that failed; the result is fetched from `response_url`; a
 * `PUT` to the cancel URL cancels. The docs are explicit that the request
 * id is durable across processes.
 *
 * Results are public CDN URLs with configurable, undocumented retention,
 * so the bytes are downloaded inside the poll that saw COMPLETED, and the
 * URL is never kept. Each model names its outputs its own way - `images[]`,
 * `image`, `video`, `videos[]` - and the answer is read for any of them.
 *
 * The base URL a connection carries is the queue host,
 * `https://queue.fal.run`; the model id is the path. Input images and first
 * frames travel as data URIs, which FAL takes in its `image_url` and
 * `image_urls` fields.
 *
 * Speech and transcription ride the same queue, and the person waits for
 * them at the read-aloud pill or the composer rather than at a job card, so
 * the adapter polls on the caller's behalf and answers bytes or words. The
 * listing's `text-to-speech` endpoints were read for their schemas on
 * 2026-09-19: every one names its text `text` or `prompt` (MiniMax and
 * Gemini the latter) and answers `audio: { url, content_type }`; every
 * `speech-to-text` endpoint takes `audio_url` and answers `text`.
 */

const AUTHOR: UrlAuthor = "user";
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const OUTPUT_MAX_BYTES = 512 * 1024 * 1024;
/** A spoken passage or a dictated sentence renders in seconds; the wait between asks is short to match. */
const AUDIO_POLL_DELAY_MS = 500;
/** The whole wait for one audio request, submit to bytes, matched to the other audio adapters. */
const AUDIO_TIMEOUT_MS = 120_000;
const SPEECH_FALLBACK_MIME = "audio/mpeg";

function origin(endpoint: DriverEndpoint): string {
  return endpoint.baseUrl.replace(/\/+$/, "");
}

function headers(endpoint: DriverEndpoint, json: boolean): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(endpoint.credential === undefined ? {} : { authorization: `Key ${endpoint.credential}` }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataUrl(image: MediaBytes): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

function refusalDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return undefined;
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      const first: unknown = parsed.detail[0];
      if (isRecord(first) && typeof first.msg === "string") return first.msg;
    }
    if (typeof parsed.error === "string") return parsed.error;
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
      ? `FAL answered ${String(status)} to the ${what} request with no explanation.`
      : `FAL refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `FAL could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

interface Submitted {
  readonly id: string;
  readonly statusUrl: string;
  readonly responseUrl: string;
  readonly cancelUrl: string | undefined;
}

async function submit(modelId: string, input: unknown, endpoint: DriverEndpoint): Promise<Submitted> {
  const answered = await requestDirect({
    url: `${origin(endpoint)}/${modelId.replace(/^\/+/, "")}`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint, true),
    body: JSON.stringify(input),
    timeoutMs: endpoint.timeoutMs ?? SUBMIT_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("submit", error);
  });
  if (answered.status >= 400) throw refused("submit", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "FAL's submit answer was not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.request_id !== "string") {
    throw new MediaError("provider-refused", "FAL's submit answer carried no request id.");
  }
  // The convenience URLs are taken as given when present, and rebuilt from
  // the queue's documented shape when not, so a terse answer still polls.
  const base = `${origin(endpoint)}/${modelId.replace(/^\/+/, "")}/requests/${parsed.request_id}`;
  return {
    id: parsed.request_id,
    statusUrl: typeof parsed.status_url === "string" ? parsed.status_url : `${base}/status`,
    responseUrl: typeof parsed.response_url === "string" ? parsed.response_url : base,
    cancelUrl: typeof parsed.cancel_url === "string" ? parsed.cancel_url : `${base}/cancel`,
  };
}

/** The last log line, as the vendor's word on progress. */
function lastLog(status: Record<string, unknown>): string | undefined {
  if (!Array.isArray(status.logs)) return undefined;
  const last: unknown = status.logs[status.logs.length - 1];
  return isRecord(last) && typeof last.message === "string" ? last.message : undefined;
}

/** Every output file in a FAL result, whatever the model called it. */
function outputUrls(result: Record<string, unknown>): readonly { url: string; contentType: string | undefined }[] {
  const found: { url: string; contentType: string | undefined }[] = [];
  const take = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) take(entry);
      return;
    }
    if (!isRecord(value) || typeof value.url !== "string") return;
    found.push({
      url: value.url,
      contentType: typeof value.content_type === "string" ? value.content_type : undefined,
    });
  };
  for (const key of ["images", "image", "video", "videos", "audio", "output"]) take(result[key]);
  return found;
}

/** Where the queue says a request stands; `completed` is the moment its result can be read. */
type QueueState =
  | { readonly state: "queued" | "running"; readonly detail?: string }
  | { readonly state: "completed" }
  | { readonly state: "failed"; readonly message: string };

async function statusOf(submitted: Submitted, endpoint: DriverEndpoint): Promise<QueueState> {
  const answered = await requestDirect({
    url: `${submitted.statusUrl}${submitted.statusUrl.includes("?") ? "&" : "?"}logs=1`,
    author: AUTHOR,
    method: "GET",
    headers: headers(endpoint, false),
    timeoutMs: POLL_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw unreachable("status", error);
  });
  if (answered.status >= 400) throw refused("status", answered.status, answered.body);
  let status: unknown;
  try {
    status = JSON.parse(answered.body);
  } catch {
    return { state: "failed", message: "FAL's status was not JSON." };
  }
  if (!isRecord(status)) return { state: "failed", message: "FAL's status was not an object." };
  switch (status.status) {
    case "IN_QUEUE": {
      const position = status.queue_position;
      return {
        state: "queued",
        ...(typeof position === "number" ? { detail: `${String(position)} ahead in the queue` } : {}),
      };
    }
    case "IN_PROGRESS": {
      const detail = lastLog(status);
      return { state: "running", ...(detail === undefined ? {} : { detail }) };
    }
    case "COMPLETED": {
      if (typeof status.error === "string" && status.error.length > 0) {
        return { state: "failed", message: status.error };
      }
      return { state: "completed" };
    }
    default:
      return { state: "failed", message: `FAL reported an unknown state "${String(status.status)}".` };
  }
}

function polled(submitted: Submitted, endpoint: DriverEndpoint, fallbackMime: string): Generation {
  const poll = async (): Promise<PollOutcome> => {
    const status = await statusOf(submitted, endpoint);
    if (status.state !== "completed") return status;
    return { state: "done", outputs: await collect(submitted, endpoint, fallbackMime) };
  };

  const cancel = async (): Promise<void> => {
    if (submitted.cancelUrl === undefined) return;
    await requestDirect({
      url: submitted.cancelUrl,
      author: AUTHOR,
      method: "PUT",
      headers: headers(endpoint, false),
      timeoutMs: POLL_TIMEOUT_MS,
    });
  };

  return { shape: "poll", job: { id: submitted.id, poll, cancel } };
}

/** The result as the vendor wrote it, read from the response URL. */
async function resultOf(submitted: Submitted, endpoint: DriverEndpoint): Promise<Record<string, unknown>> {
  const answered = await requestDirect({
    url: submitted.responseUrl,
    author: AUTHOR,
    method: "GET",
    headers: headers(endpoint, false),
    timeoutMs: POLL_TIMEOUT_MS,
    maxBytes: OUTPUT_MAX_BYTES,
  }).catch((error: unknown) => {
    throw unreachable("result", error);
  });
  if (answered.status >= 400) throw refused("result", answered.status, answered.body);
  let result: unknown;
  try {
    result = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "FAL's result was not JSON.");
  }
  if (!isRecord(result)) throw new MediaError("provider-refused", "FAL's result was not an object.");
  return result;
}

/** The result, read from the response URL and downloaded file by file. */
async function collect(
  submitted: Submitted,
  endpoint: DriverEndpoint,
  fallbackMime: string,
): Promise<readonly MediaBytes[]> {
  const urls = outputUrls(await resultOf(submitted, endpoint));
  if (urls.length === 0) {
    throw new MediaError("provider-refused", "FAL's result carried no file.");
  }
  const outputs: MediaBytes[] = [];
  for (const output of urls) {
    const file = await requestBinary({
      url: output.url,
      author: AUTHOR,
      method: "GET",
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBytes: OUTPUT_MAX_BYTES,
    }).catch((error: unknown) => {
      throw unreachable("download", error);
    });
    if (file.status >= 400) throw refused("download", file.status, file.bytes.toString("utf8"));
    const header = file.headers["content-type"]?.split(";")[0]?.trim();
    outputs.push({
      bytes: new Uint8Array(file.bytes),
      mimeType: output.contentType ?? (header !== undefined && header.length > 0 ? header : fallbackMime),
    });
  }
  return outputs;
}

async function generateImage(input: ImageGenerationInput, endpoint: DriverEndpoint): Promise<Generation> {
  // Two families of input, checked against the published schemas on
  // 2026-09-16: the current edits - nano-banana, flux-2, seedream, gpt-image -
  // require the plural `image_urls`, while the older image-to-image endpoints
  // require the singular `image_url`, and the singular key went to models
  // that were not looking for it, which is where "at least one image URL is
  // required" came from. Neither family forbids extra properties, so both
  // keys always ride: the plural carries every reference, the singular the
  // first, and each endpoint reads its own - a singular endpoint handed
  // several references simply works from the first, the only shape it has.
  const references = input.inputImages ?? [];
  const first = references[0];
  const body = {
    prompt: input.prompt,
    ...(input.count === undefined ? {} : { num_images: input.count }),
    ...(input.aspectRatio === undefined ? {} : { aspect_ratio: input.aspectRatio }),
    ...(references.length === 0 ? {} : { image_urls: references.map(dataUrl) }),
    ...(first === undefined ? {} : { image_url: dataUrl(first) }),
  };
  return polled(await submit(input.modelId, body, endpoint), endpoint, "image/png");
}

async function generateVideo(input: VideoGenerationInput, endpoint: DriverEndpoint): Promise<Generation> {
  const body = {
    prompt: input.prompt,
    ...(input.durationSeconds === undefined ? {} : { duration: String(input.durationSeconds) }),
    ...(input.aspectRatio === undefined ? {} : { aspect_ratio: input.aspectRatio }),
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
    ...(input.image === undefined ? {} : { image_url: dataUrl(input.image) }),
  };
  return polled(await submit(input.modelId, body, endpoint), endpoint, "video/mp4");
}

/**
 * One audio request waited out here rather than in the job registry: the
 * caller is a person at a pill, and the driver contract answers bytes. The
 * wait is bounded so a wedged queue is a refusal the pill can show and not
 * a spinner it cannot end.
 */
async function awaitAudio(submitted: Submitted, endpoint: DriverEndpoint, what: string): Promise<void> {
  const deadline = Date.now() + (endpoint.timeoutMs ?? AUDIO_TIMEOUT_MS);
  for (;;) {
    const status = await statusOf(submitted, endpoint);
    if (status.state === "completed") return;
    if (status.state === "failed") {
      throw new MediaError("provider-refused", `FAL refused the ${what} request: ${status.message}`);
    }
    if (Date.now() >= deadline) {
      throw new MediaError("provider-refused", `FAL did not finish the ${what} request in time.`, {
        retryable: true,
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, AUDIO_POLL_DELAY_MS));
  }
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  // Both spellings of the text ride, as both spellings of the image URL do
  // for the image endpoints: each model reads its own and ignores the other.
  const body = {
    text: input.text,
    prompt: input.text,
    ...(input.voiceId === undefined ? {} : { voice: input.voiceId }),
  };
  const submitted = await submit(input.modelId, body, endpoint);
  await awaitAudio(submitted, endpoint, "speech");
  const outputs = await collect(submitted, endpoint, SPEECH_FALLBACK_MIME);
  const first = outputs[0];
  if (first === undefined || first.bytes.length === 0) {
    throw new MediaError("provider-refused", "FAL returned no audio.");
  }
  return { audio: Buffer.from(first.bytes).toString("base64"), mimeType: first.mimeType };
}

async function transcribe(input: TranscriptionSlotInput, endpoint: DriverEndpoint) {
  const submitted = await submit(
    input.modelId,
    { audio_url: dataUrl({ bytes: input.audio, mimeType: input.mimeType }) },
    endpoint,
  );
  await awaitAudio(submitted, endpoint, "transcription");
  const result = await resultOf(submitted, endpoint);
  if (typeof result.text !== "string") {
    throw new MediaError("provider-refused", "FAL's transcription carried no text.");
  }
  return { text: result.text };
}

export const falMedia: MediaAdapter = {
  protocol: "fal",
  speak,
  transcribe,
  generateImage,
  generateVideo,
};
