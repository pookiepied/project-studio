/**
 * image_generate — generate/edit/compose an image via the gateway, store the
 * result in R2, and return a public serving URL.
 *
 * Ported from the chat worker's ImageGenerateTool. Differences:
 *   - env passed explicitly.
 *   - The public image URL base comes from env.PUBLIC_IMAGE_BASE (a configured
 *     value) instead of chat's request-scoped getRequestBaseUrl(), since this
 *     worker has no ambient incoming-request origin.
 *   - storeGeneratedImage is inlined (simple R2 put; generated images are not
 *     presigned — they are served by the gateway's /v1/images/:id route).
 */

export interface ImageGenEnv {
  GATEWAY?:           Fetcher;
  IMAGES_BUCKET?:     R2Bucket;
  PUBLIC_IMAGE_BASE?: string;
}

export interface ImageGenerateArgs {
  model: string;
  prompt: string;
  source_image?: string;
  reference_images?: string[];
  font_text?: string;
  aspect_ratio?: string;
  image_size?: string;
  style?: string;
}

const STYLE_PREFIXES: Record<string, string> = {
  photorealistic: "photorealistic, high quality, sharp focus, detailed, ",
  anime:          "anime style, vibrant colors, cel shading, ",
  cinematic:      "cinematic, dramatic lighting, film still, widescreen, ",
  "oil-painting": "oil painting, textured brushstrokes, classical art, ",
  watercolor:     "watercolor painting, soft edges, flowing colors, ",
  sketch:         "pencil sketch, hand-drawn, fine line art, ",
  "digital-art":  "digital art, concept art, vibrant, ",
  none:           "",
};

const ASPECT_RATIO_SIZES: Record<string, { width: number; height: number }> = {
  "1:1":  { width: 1024, height: 1024 },
  "16:9": { width: 1792, height: 1024 },
  "9:16": { width: 1024, height: 1792 },
  "4:3":  { width: 1024, height: 768 },
  "3:4":  { width: 768,  height: 1024 },
  "21:9": { width: 2048, height: 896 },
};

async function storeGeneratedImage(
  bucket:   R2Bucket,
  bytes:    Uint8Array,
  mimeType: string,
): Promise<string | null> {
  const imageId = crypto.randomUUID();
  const key     = `images/${imageId}`;
  try {
    await bucket.put(key, bytes, {
      httpMetadata:   { contentType: mimeType },
      customMetadata: { purpose: "generated-image", createdAt: Date.now().toString(), mimeType },
    });
    return imageId;
  } catch {
    return null;
  }
}

export async function runImageGenerate(env: ImageGenEnv, args: ImageGenerateArgs): Promise<unknown> {
  if (!env?.GATEWAY)       return { error: "GATEWAY service binding is not configured." };
  if (!env?.IMAGES_BUCKET) return { error: "IMAGES_BUCKET R2 binding is not configured." };

  const model            = String(args.model ?? "");
  const prompt           = String(args.prompt ?? "");
  const { source_image, reference_images, font_text, image_size } = args;
  const aspect_ratio     = args.aspect_ratio ?? "1:1";
  const style            = args.style ?? "none";

  const colonIdx = model.indexOf(":");
  const provider = colonIdx === -1 ? "openrouter" : model.slice(0, colonIdx);
  const modelId  = colonIdx === -1 ? model : model.slice(colonIdx + 1);

  const stylePrefix = STYLE_PREFIXES[style] ?? "";
  const finalPrompt = `${stylePrefix}${prompt}`;
  const { width, height } = ASPECT_RATIO_SIZES[aspect_ratio] ?? ASPECT_RATIO_SIZES["1:1"];

  const hasSourceImage     = !!source_image;
  const hasReferenceImages = Array.isArray(reference_images) && reference_images.length > 0;
  const hasTypography      = !!font_text;
  const modeLabel = hasSourceImage
    ? "edit"
    : hasReferenceImages
    ? "multi-reference"
    : hasTypography
    ? "typography"
    : "text-to-image";

  const requestBody = {
    provider,
    modelId,
    prompt:           finalPrompt,
    aspect_ratio,
    source_image:     source_image ?? undefined,
    reference_images: reference_images ?? undefined,
    font_text:        font_text ?? undefined,
    image_size:       image_size ?? undefined,
  };

  let imageBytes: Uint8Array;
  let contentType = "image/png";
  try {
    const gatewayResp = await env.GATEWAY.fetch("http://studio-gateway/v1/images/generate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(requestBody),
    });

    if (!gatewayResp.ok) {
      const errText = await gatewayResp.text();
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
      return { error: `Image generation failed: ${errMsg}` };
    }

    contentType = gatewayResp.headers.get("content-type") ?? "image/png";
    imageBytes  = new Uint8Array(await gatewayResp.arrayBuffer());
  } catch (e: any) {
    return { error: `Gateway request failed: ${e.message}` };
  }

  const imageId = await storeGeneratedImage(env.IMAGES_BUCKET, imageBytes, contentType);
  if (!imageId) return { error: "Failed to store image in R2." };

  const baseUrl         = (env.PUBLIC_IMAGE_BASE ?? "").replace(/\/$/, "");
  const imageUrl        = `${baseUrl}/v1/images/${imageId}`;
  const styleLabel      = style !== "none" ? ` · ${style}` : "";
  const markdownSnippet = `![Generated image — ${aspect_ratio}${styleLabel}](${imageUrl})`;

  return {
    imageUrl,
    dimensions:      `${width}×${height}`,
    aspectRatio:     aspect_ratio,
    style,
    mode:            modeLabel,
    backend:         `${provider}/${modelId}`,
    markdownSnippet,
  };
}
