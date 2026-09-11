import { HttpError, requestBinary, requestDirect } from "../../../net/http.js";
import type { UrlAuthor } from "../../../net/destination.js";
import { MediaError } from "../../../contracts/media.js";
import type { DriverEndpoint, SpeechSlotInput } from "../drivers/types.js";
import type { Generation, MediaAdapter, MediaBytes, PollOutcome, VideoGenerationInput } from "./types.js";

/**
 * MiniMax: speech through T2A, and video through the H3 task API, on one
 * Bearer key. Checked against platform.minimax.io on 2026-09-11.
 *
 * - `POST /v1/t2a_v2` - JSON with the model, the text, a voice setting and
 *   an audio setting; the answer is `{ data: { audio }, base_resp }` where
 *   `audio` is **hex**, not base64, and `base_resp.status_code` must be
 *   zero even when the HTTP status is 200. Both quirks are absorbed here.
 * - `POST /v2/video_generation` with a content array - text, and a first
 *   frame as an image_url data URL - answers `task_id`; `GET
 *   /v2/query/video_generation/{task_id}` walks queued, running, succeeded,
 *   failed, cancelled, and a succeeded task carries `content.url`, which
 *   the docs call time-limited. Downloaded inside the poll, never kept. No
 *   cancel endpoint is documented; a Stop stops asking.
 *
 * The base URL a connection carries is `https://api.minimax.io`, with the
 * version in each path, because the two APIs live under different ones.
 */

const AUTHOR: UrlAuthor = "user";
const SPEECH_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_VOICE = "English_expressive_narrator";
const SPEECH_MIME = "audio/mpeg";

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

/** MiniMax's own status envelope, present on every JSON answer. */
function envelopeFailure(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !isRecord(parsed.base_resp)) return undefined;
  const code = parsed.base_resp.status_code;
  if (typeof code === "number" && code !== 0) {
    const message = parsed.base_resp.status_msg;
    return typeof message === "string" && message.length > 0 ? message : `status ${String(code)}`;
  }
  return undefined;
}

function refused(what: string, status: number, body: string): MediaError {
  let detail: string | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    detail = envelopeFailure(parsed);
    if (detail === undefined && isRecord(parsed) && typeof parsed.message === "string") detail = parsed.message;
  } catch {
    detail = undefined;
  }
  return new MediaError(
    "provider-refused",
    detail === undefined
      ? `MiniMax answered ${String(status)} to the ${what} request with no explanation.`
      : `MiniMax refused the ${what} request: ${detail}`,
  );
}

function unreachable(what: string, error: unknown): MediaError {
  return new MediaError(
    "provider-refused",
    error instanceof HttpError ? error.message : `MiniMax could not be reached for the ${what} request.`,
    { retryable: error instanceof HttpError && error.retryable },
  );
}

async function speak(input: SpeechSlotInput, endpoint: DriverEndpoint) {
  const answered = await requestDirect({
    url: `${origin(endpoint)}/v1/t2a_v2`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({
      model: input.modelId,
      text: input.text,
      stream: false,
      output_format: "hex",
      voice_setting: { voice_id: input.voiceId ?? DEFAULT_VOICE, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    }),
    timeoutMs: endpoint.timeoutMs ?? SPEECH_TIMEOUT_MS,
    maxBytes: 64 * 1024 * 1024,
  }).catch((error: unknown) => {
    throw unreachable("speech", error);
  });
  if (answered.status >= 400) throw refused("speech", answered.status, answered.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(answered.body);
  } catch {
    throw new MediaError("provider-refused", "MiniMax's speech answer was not JSON.");
  }
  const failure = envelopeFailure(parsed);
  if (failure !== undefined) {
    throw new MediaError("provider-refused", `MiniMax refused the speech request: ${failure}`);
  }
  const hex = isRecord(parsed) && isRecord(parsed.data) && typeof parsed.data.audio === "string" ? parsed.data.audio : "";
  if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new MediaError("provider-refused", "MiniMax returned no audio.");
  }
  return { audio: Buffer.from(hex, "hex").toString("base64"), mimeType: SPEECH_MIME };
}

async function generateVideo(input: VideoGenerationInput, endpoint: DriverEndpoint): Promise<Generation> {
  const body = {
    model: input.modelId,
    content: [
      { type: "text", text: input.prompt },
      ...(input.image === undefined
        ? []
        : [
            {
              type: "image_url",
              image_url: {
                url: `data:${input.image.mimeType};base64,${Buffer.from(input.image.bytes).toString("base64")}`,
              },
              role: "first_frame",
            },
          ]),
    ],
    ...(input.durationSeconds === undefined ? {} : { duration: input.durationSeconds }),
    ...(input.aspectRatio === undefined ? {} : { ratio: input.aspectRatio }),
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
  };
  const submitted = await requestDirect({
    url: `${origin(endpoint)}/v2/video_generation`,
    author: AUTHOR,
    method: "POST",
    headers: headers(endpoint),
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
    throw new MediaError("provider-refused", "MiniMax's video answer was not JSON.");
  }
  const failure = envelopeFailure(parsed);
  if (failure !== undefined) {
    throw new MediaError("provider-refused", `MiniMax refused the video request: ${failure}`);
  }
  if (!isRecord(parsed) || typeof parsed.task_id !== "string" || parsed.task_id.length === 0) {
    throw new MediaError("provider-refused", "MiniMax's video answer carried no task id.");
  }
  const taskId = parsed.task_id;

  const poll = async (): Promise<PollOutcome> => {
    const answered = await requestDirect({
      url: `${origin(endpoint)}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
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
      return { state: "failed", message: "MiniMax's video status was not JSON." };
    }
    const envelope = envelopeFailure(status);
    if (envelope !== undefined) return { state: "failed", message: envelope };
    const task = isRecord(status) && isRecord(status.task) ? status.task : undefined;
    const state = task !== undefined && typeof task.status === "string" ? task.status : "";
    switch (state) {
      case "queued":
        return { state: "queued" };
      case "running":
        return { state: "running" };
      case "succeeded": {
        const url = isRecord(task?.content) && typeof task.content.url === "string" ? task.content.url : undefined;
        if (url === undefined) return { state: "failed", message: "MiniMax finished the video without a file." };
        return { state: "done", outputs: [await download(url)] };
      }
      case "failed":
      case "cancelled": {
        const message =
          isRecord(task?.error) && typeof task.error.message === "string"
            ? task.error.message
            : `MiniMax reported the video as ${state}.`;
        return { state: "failed", message };
      }
      default:
        return { state: "failed", message: `MiniMax reported an unknown video state "${state}".` };
    }
  };

  return { shape: "poll", job: { id: taskId, poll } };
}

async function download(url: string): Promise<MediaBytes> {
  const answered = await requestBinary({
    url,
    author: AUTHOR,
    method: "GET",
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: VIDEO_MAX_BYTES,
  }).catch((error: unknown) => {
    throw unreachable("video download", error);
  });
  if (answered.status >= 400) throw refused("video download", answered.status, answered.bytes.toString("utf8"));
  if (answered.bytes.length === 0) throw new MediaError("provider-refused", "MiniMax's finished video was empty.");
  const contentType = answered.headers["content-type"]?.split(";")[0]?.trim();
  return {
    bytes: new Uint8Array(answered.bytes),
    mimeType: contentType !== undefined && contentType.startsWith("video/") ? contentType : "video/mp4",
  };
}

export const minimaxMedia: MediaAdapter = {
  protocol: "minimax",
  speak,
  generateVideo,
};
