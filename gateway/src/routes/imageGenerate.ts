import type { GatewayEnv } from "../env";
import { logger }          from "../logger";
import { recordUsage }     from "../tracking/usage";

// ── Provider-specific mappings ────────────────────────────────────────────────

const FAL_SIZE_MAP: Record<string, string> = {
  "1:1":  "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3":  "landscape_4_3",
  "3:4":  "portrait_4_3",
  "21:9": "landscape_16_9",
};

const DALLE_SIZE_MAP: Record<string, string> = {
  "1:1":  "1024x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
};

import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../config/constants";

// ── Request shape ─────────────────────────────────────────────────────────────

export interface ImageGenerateRequest {
  provider: string;
  modelId:  string;
  prompt:   string;
  aspect_ratio?:     string;
  source_image?:     string;
  reference_images?: string[];
  font_text?:        string;
  image_size?:       string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errResp(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ error: { message, type: "image_generation_error" } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function imageResp(body: BodyInit, contentType: string, provider: string): Response {
  return new Response(body, {
    status:  200,
    headers: { "Content-Type": contentType, "X-Image-Provider": provider },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleImageGenerate(
  request: Request,
  env:     GatewayEnv,
  ctx?:    ExecutionContext,
): Promise<Response> {
  const requestStart = Date.now();
  const userId       = request.headers.get("x-user-id") ?? undefined;

  let body: ImageGenerateRequest;
  try {
    body = await request.json() as ImageGenerateRequest;
  } catch {
    return errResp("Invalid JSON body.", 400);
  }

  const { provider, modelId, prompt, aspect_ratio = "1:1" } = body;
  if (!provider || !modelId || !prompt) {
    return errResp("Required fields: provider, modelId, prompt.", 400);
  }

  try {
    let result: Response;
    switch (provider) {
      case "fal":        result = await generateViaFal(env, modelId, prompt, body, aspect_ratio); break;
      case "openrouter": result = await generateViaOpenRouter(env, modelId, prompt, body, aspect_ratio); break;
      case "openai":     result = await generateViaOpenAI(env, modelId, prompt, aspect_ratio); break;
      default:
        return errResp(`Unknown image provider '${provider}'. Supported: fal, openrouter, openai.`, 400);
    }
    recordUsage({
      env, ctx, userId, provider, model: modelId,
      capturedUsage: null, requestStart, requestType: "image",
      status: result.ok ? "success" : "error",
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Image generation failed", { provider, model: modelId, error: msg });
    recordUsage({ env, ctx, userId, provider, model: modelId, capturedUsage: null, requestStart, requestType: "image", status: "error" });
    return errResp(`Image generation error: ${msg}`, 500);
  }
}

// ── Provider implementations ──────────────────────────────────────────────────

async function generateViaFal(
  env:     GatewayEnv,
  modelId: string,
  prompt:  string,
  args:    ImageGenerateRequest,
  ratio:   string,
): Promise<Response> {
  if (!env.FAL_API_KEY) return errResp("FAL_API_KEY is not configured.", 500);

  const input: Record<string, unknown> = {
    prompt,
    image_size: FAL_SIZE_MAP[ratio] ?? "square_hd",
    num_images: 1,
  };
  if (args.source_image) input.image_url = args.source_image;

  const resp = await fetch(`https://fal.run/${modelId}`, {
    method:  "POST",
    headers: { Authorization: `Key ${env.FAL_API_KEY}`, "Content-Type": "application/json" },
    signal:  AbortSignal.timeout(28_000),
    body:    JSON.stringify(input),
  });
  if (!resp.ok) {
    return errResp(`fal.ai returned ${resp.status}. Please try again.`, 502);
  }

  const data     = await resp.json() as Record<string, unknown>;
  const imgEntry = (Array.isArray(data.images) ? data.images[0] : data.image) as Record<string, unknown> | null;
  if (!imgEntry?.url) {
    return errResp(`fal.ai returned no image URL. Response keys: ${Object.keys(data).join(", ")}`, 502);
  }

  const mimeType = (imgEntry.content_type as string | undefined) ?? "image/jpeg";
  const cdnResp  = await fetch(imgEntry.url as string, { signal: AbortSignal.timeout(15_000) });
  if (!cdnResp.ok) return errResp(`Failed to download from fal.ai CDN (${cdnResp.status})`, 502);

  return imageResp(cdnResp.body!, mimeType, "fal");
}

async function generateViaOpenRouter(
  env:     GatewayEnv,
  modelId: string,
  prompt:  string,
  args:    ImageGenerateRequest,
  ratio:   string,
): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return errResp("OPENROUTER_API_KEY is not configured.", 500);

  const contentParts: unknown[] = [{ type: "text", text: prompt }];
  if (args.source_image) {
    contentParts.push({ type: "image_url", image_url: { url: args.source_image } });
  }
  for (const url of (args.reference_images ?? []).slice(0, 4)) {
    contentParts.push({ type: "image_url", image_url: { url } });
  }

  const imageConfig: Record<string, unknown> = { aspect_ratio: ratio };
  if (args.image_size) imageConfig.image_size = args.image_size;
  if (args.font_text)  imageConfig.font_inputs = [{ font_name: "default", text: args.font_text }];

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
      model:        modelId,
      messages:     [{ role: "user", content: contentParts }],
      modalities:   ["image"],
      image_config: imageConfig,
    }),
  });
  if (!resp.ok) {
    return errResp(`OpenRouter image returned ${resp.status}. Please try again.`, 502);
  }

  const data = await resp.json() as Record<string, unknown>;
  const msg  = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
  const msgContent = (msg?.message as Record<string, unknown> | undefined);

  let rawUrl: string | null = null;
  const images = (msgContent?.images ?? []) as unknown[];
  if (images.length > 0) {
    const img = images[0] as Record<string, unknown>;
    if (typeof img.url === "string")                                                rawUrl = img.url;
    else if (img.type === "image_url" && typeof (img.image_url as Record<string, unknown>)?.url === "string")
      rawUrl = (img.image_url as Record<string, unknown>).url as string;
    else if (typeof img.b64_json === "string") rawUrl = `data:image/png;base64,${img.b64_json}`;
    else if (typeof img.data === "string")     rawUrl = `data:image/png;base64,${img.data}`;
  }
  const content = msgContent?.content;
  if (!rawUrl && Array.isArray(content)) {
    for (const part of content as Record<string, unknown>[]) {
      if (part.type === "image_url") { rawUrl = (part.image_url as Record<string, unknown>)?.url as string ?? null; break; }
      if (part.type === "image")     { rawUrl = (part as Record<string, unknown>).url as string ?? null; break; }
    }
  }
  if (!rawUrl && typeof content === "string" && content.length > 0) rawUrl = content.trim();
  if (!rawUrl) {
    return errResp(`OpenRouter returned no image. finish_reason=${(msg?.finish_reason ?? "unknown")}`, 502);
  }

  if (rawUrl.startsWith("data:")) {
    const comma = rawUrl.indexOf(",");
    const mime  = rawUrl.slice(5, comma).split(";")[0] || "image/png";
    const bin   = atob(rawUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return imageResp(bytes, mime, "openrouter");
  }

  const imgResp = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imgResp.ok) return errResp("Failed to download generated image from OpenRouter.", 502);
  return imageResp(imgResp.body!, imgResp.headers.get("content-type") ?? "image/png", "openrouter");
}

async function generateViaOpenAI(
  env:     GatewayEnv,
  modelId: string,
  prompt:  string,
  ratio:   string,
): Promise<Response> {
  if (!env.OPENAI_API_KEY) return errResp("OPENAI_API_KEY is not configured.", 500);

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method:  "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    signal:  AbortSignal.timeout(28_000),
    body:    JSON.stringify({
      model: modelId,
      prompt,
      n:               1,
      size:            DALLE_SIZE_MAP[ratio] ?? "1024x1024",
      response_format: "b64_json",
    }),
  });
  if (!resp.ok) {
    return errResp(`OpenAI image returned ${resp.status}. Please try again.`, 502);
  }

  const data = await resp.json() as Record<string, unknown>;
  const b64  = ((data.data as unknown[])?.[0] as Record<string, unknown>)?.b64_json as string | undefined;
  if (!b64) return errResp("OpenAI returned no image data.", 502);

  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return imageResp(bytes, "image/png", "openai");
}

