import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint } from "../drivers/types.js";
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
 * frames travel as data URIs, which FAL takes in `image_url` fields.
 */

const AUTHOR: UrlAuthor = "user";
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const OUTPUT_MAX_BYTES = 512 * 1024 * 1024;

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
  for (const key of ["images", "image", "video", "videos", "output"]) take(result[key]);
  return found;
}

function polled(submitted: Submitted, endpoint: DriverEndpoint, fallbackMime: string): Generation {
  const poll = async (): Promise<PollOutcome> => {
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
        return { state: "done", outputs: await collect(submitted, endpoint, fallbackMime) };
      }
      default:
        return { state: "failed", message: `FAL reported an unknown state "${String(status.status)}".` };
    }
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

/** The result, read from the response URL and downloaded file by file. */
async function collect(
  submitted: Submitted,
  endpoint: DriverEndpoint,
  fallbackMime: string,
): Promise<readonly MediaBytes[]> {
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
  const urls = isRecord(result) ? outputUrls(result) : [];
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
  const references = input.inputImages ?? [];
  const body = {
    prompt: input.prompt,
    ...(input.count === undefined ? {} : { num_images: input.count }),
    ...(input.aspectRatio === undefined ? {} : { aspect_ratio: input.aspectRatio }),
    ...(references.length === 1 ? { image_url: dataUrl(references[0] as MediaBytes) } : {}),
    ...(references.length > 1 ? { image_urls: references.map(dataUrl) } : {}),
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

export const falMedia: MediaAdapter = {
  protocol: "fal",
  generateImage,
  generateVideo,
};
