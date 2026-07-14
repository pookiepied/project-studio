/**
 * Video generation — async submit + polling.
 *
 * POST /v1/videos/generate  — submit a video job, return job_id immediately
 * GET  /v1/videos/status/:jobId — poll job status, return video_url when done
 *
 * Supported providers:
 *   fal       — fal.ai async queue (fal-ai/kling-video, wan, luma, etc.)
 *   openrouter — POST to chat/completions with modalities:["video"]
 *
 * Job ID format: base64url-encoded JSON { p, m, r } (provider, modelId, requestId).
 * Self-contained — no KV or DO required.
 */

import type { GatewayEnv } from "../env";
import { logger }           from "../logger";
import { recordUsage }      from "../tracking/usage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoGenerateRequest {
  provider:      string;
  modelId:       string;
  prompt:        string;
  duration?:     number;
  aspect_ratio?: string;
  source_image?: string;
  negative_prompt?: string;
}

export interface VideoStatusResponse {
  job_id:         string;
  status:         "pending" | "processing" | "completed" | "failed";
  progress?:      number;
  video_url?:     string;
  thumbnail_url?: string;
  duration_secs?: number;
  provider:       string;
  model:          string;
  error?:         string;
}

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../config/constants";

// ── Job ID helpers ─────────────────────────────────────────────────────────────

function encodeJobId(provider: string, modelId: string, requestId: string): string {
  const json = JSON.stringify({ p: provider, m: modelId, r: requestId });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodeJobId(jobId: string): { provider: string; modelId: string; requestId: string } {
  const padded = jobId.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - padded.length % 4);
  const json = atob(padded + padding);
  const { p, m, r } = JSON.parse(json) as { p: string; m: string; r: string };
  return { provider: p, modelId: m, requestId: r };
}

// ── Error helper ──────────────────────────────────────────────────────────────

function errResp(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ error: { message, type: "video_generation_error" } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// ── POST /v1/videos/generate ──────────────────────────────────────────────────

export async function handleVideoGenerate(
  request: Request,
  env:     GatewayEnv,
  ctx?:    ExecutionContext,
): Promise<Response> {
  const requestStart = Date.now();
  const userId       = request.headers.get("x-user-id") ?? undefined;

  let body: VideoGenerateRequest;
  try {
    body = await request.json() as VideoGenerateRequest;
  } catch {
    return errResp("Invalid JSON body.", 400);
  }

  const { provider, modelId, prompt } = body;
  if (!provider || !modelId || !prompt) {
    return errResp("Required fields: provider, modelId, prompt.", 400);
  }

  try {
    let jobId: string;
    switch (provider) {
      case "fal":
        jobId = await submitFalVideo(env, body);
        break;
      case "openrouter":
        jobId = await submitOpenRouterVideo(env, body);
        break;
      default:
        return errResp(`Unknown video provider '${provider}'. Supported: fal, openrouter.`, 400);
    }

    recordUsage({ env, ctx, userId, provider, model: modelId, capturedUsage: null, requestStart, requestType: "video", status: "success" });
    return new Response(
      JSON.stringify({ job_id: jobId, status: "pending", provider, model: modelId }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Video job submission failed", { provider, model: modelId, error: msg });
    recordUsage({ env, ctx, userId, provider, model: modelId, capturedUsage: null, requestStart, requestType: "video", status: "error" });
    return errResp(`Video generation error: ${msg}`, 500);
  }
}

// ── GET /v1/videos/status/:jobId ──────────────────────────────────────────────

export async function handleVideoStatus(
  jobId: string,
  env:   GatewayEnv,
): Promise<Response> {
  let decoded: { provider: string; modelId: string; requestId: string };
  try {
    decoded = decodeJobId(jobId);
  } catch {
    return errResp("Invalid job_id.", 400);
  }

  const { provider, modelId, requestId } = decoded;

  try {
    let result: VideoStatusResponse;
    switch (provider) {
      case "fal":
        result = await pollFalVideo(env, jobId, modelId, requestId);
        break;
      case "openrouter":
        result = await pollOpenRouterVideo(env, jobId, modelId, requestId);
        break;
      default:
        return errResp(`Unknown video provider '${provider}'.`, 400);
    }

    return new Response(JSON.stringify(result), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Video status poll failed", { provider, model: modelId, requestId, error: msg });
    return errResp(`Status poll error: ${msg}`, 500);
  }
}

// ── fal.ai implementation ─────────────────────────────────────────────────────

const FAL_ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1":  "1:1",
  "16:9": "16:9",
  "9:16": "9:16",
  "4:3":  "4:3",
  "3:4":  "3:4",
  "21:9": "21:9",
};

async function submitFalVideo(env: GatewayEnv, body: VideoGenerateRequest): Promise<string> {
  if (!env.FAL_API_KEY) throw new Error("FAL_API_KEY is not configured.");

  const input: Record<string, unknown> = {
    prompt:       body.prompt,
    aspect_ratio: FAL_ASPECT_RATIO_MAP[body.aspect_ratio ?? "16:9"] ?? "16:9",
  };
  if (body.duration)         input.duration         = body.duration;
  if (body.source_image)     input.image_url        = body.source_image;
  if (body.negative_prompt)  input.negative_prompt  = body.negative_prompt;

  const resp = await fetch(`https://queue.fal.run/${body.modelId}`, {
    method:  "POST",
    headers: {
      Authorization:  `Key ${env.FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    throw new Error(`fal.ai queue returned ${resp.status}. Please try again.`);
  }

  const data = await resp.json() as { request_id: string };
  if (!data.request_id) throw new Error("fal.ai did not return a request_id.");

  return encodeJobId("fal", body.modelId, data.request_id);
}

async function pollFalVideo(
  env:       GatewayEnv,
  jobId:     string,
  modelId:   string,
  requestId: string,
): Promise<VideoStatusResponse> {
  if (!env.FAL_API_KEY) throw new Error("FAL_API_KEY is not configured.");

  const headers = { Authorization: `Key ${env.FAL_API_KEY}` };

  // Check status first
  const statusResp = await fetch(
    `https://queue.fal.run/${modelId}/requests/${requestId}/status`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!statusResp.ok) {
    throw new Error(`fal.ai status error (${statusResp.status})`);
  }
  const status = await statusResp.json() as {
    status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    queue_position?: number;
    logs?: Array<{ message: string }>;
  };

  if (status.status === "IN_QUEUE") {
    return { job_id: jobId, status: "pending",    provider: "fal", model: modelId };
  }
  if (status.status === "IN_PROGRESS") {
    return { job_id: jobId, status: "processing", provider: "fal", model: modelId };
  }
  if (status.status === "FAILED") {
    const errorMsg = status.logs?.map(l => l.message).join(" ") ?? "Generation failed";
    return { job_id: jobId, status: "failed", provider: "fal", model: modelId, error: errorMsg };
  }

  // COMPLETED — fetch the result
  const resultResp = await fetch(
    `https://queue.fal.run/${modelId}/requests/${requestId}`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!resultResp.ok) {
    throw new Error(`fal.ai result fetch error (${resultResp.status})`);
  }
  const result = await resultResp.json() as Record<string, unknown>;

  const video = (result.video ?? (result.videos as unknown[])?.[0] ?? result.output) as Record<string, unknown> | undefined;
  const videoUrl = (video?.url ?? video?.path ?? result.video_url) as string | undefined;
  if (!videoUrl) {
    throw new Error(`fal.ai returned no video URL. Keys: ${Object.keys(result).join(", ")}`);
  }

  return {
    job_id:         jobId,
    status:         "completed",
    video_url:      videoUrl,
    thumbnail_url:  video?.thumbnail_url as string | undefined,
    duration_secs:  video?.duration as number | undefined,
    provider:       "fal",
    model:          modelId,
  };
}

// ── OpenRouter video implementation ───────────────────────────────────────────

async function submitOpenRouterVideo(env: GatewayEnv, body: VideoGenerateRequest): Promise<string> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");

  const contentParts: unknown[] = [{ type: "text", text: body.prompt }];
  if (body.source_image) {
    contentParts.push({ type: "image_url", image_url: { url: body.source_image } });
  }

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL ?? STUDIO_SITE_URL,
      "X-Title":      STUDIO_APP_TITLE,
    },
    signal: AbortSignal.timeout(28_000),
    body: JSON.stringify({
      model:      body.modelId,
      messages:   [{ role: "user", content: contentParts }],
      modalities: ["video"],
      ...(body.aspect_ratio ? { video_config: { aspect_ratio: body.aspect_ratio } } : {}),
    }),
  });
  if (!resp.ok) {
    throw new Error(`OpenRouter video returned ${resp.status}. Please try again.`);
  }

  const data     = await resp.json() as Record<string, unknown>;
  const genId    = (data as any).id as string | undefined;
  const requestId = genId ?? crypto.randomUUID();

  // OpenRouter video generation may be synchronous for some providers.
  // Try to extract a video URL from the response immediately.
  const videoUrl = extractOpenRouterVideoUrl(data);
  if (videoUrl) {
    return encodeJobId("openrouter", body.modelId, `sync:${btoa(videoUrl)}`);
  }

  // Async — return the generation ID for polling
  return encodeJobId("openrouter", body.modelId, requestId);
}

async function pollOpenRouterVideo(
  _env:      GatewayEnv,
  jobId:     string,
  modelId:   string,
  requestId: string,
): Promise<VideoStatusResponse> {
  // Handle synchronous results encoded in the job ID
  if (requestId.startsWith("sync:")) {
    const urlB64 = requestId.slice(5);
    let videoUrl: string;
    try {
      videoUrl = atob(urlB64);
    } catch {
      videoUrl = urlB64;
    }
    return {
      job_id:    jobId,
      status:    "completed",
      video_url: videoUrl,
      provider:  "openrouter",
      model:     modelId,
    };
  }

  // True async polling — not yet standardized on OpenRouter; report as processing
  // and direct clients to retry until the provider surface a status endpoint.
  return { job_id: jobId, status: "processing", provider: "openrouter", model: modelId };
}

function extractOpenRouterVideoUrl(data: Record<string, unknown>): string | null {
  const choices = data.choices as Record<string, unknown>[] | undefined;
  if (!choices?.length) return null;

  const msg     = (choices[0].message ?? choices[0]) as Record<string, unknown>;
  const content = msg?.content;

  if (typeof content === "string" && (content.startsWith("http") || content.startsWith("data:"))) {
    return content;
  }
  if (Array.isArray(content)) {
    for (const part of content as Record<string, unknown>[]) {
      if (part.type === "video_url") return (part.video_url as Record<string, unknown>)?.url as string ?? null;
      if (part.type === "video")     return part.url as string ?? null;
    }
  }
  const videos = (msg?.videos ?? data.videos) as unknown[] | undefined;
  if (Array.isArray(videos) && videos.length > 0) {
    const v = videos[0] as Record<string, unknown>;
    return v.url as string ?? v.path as string ?? null;
  }
  return null;
}
