/**
 * R2 image storage helpers.
 *
 * Two storage tiers:
 *   storeTempImage       — TEMP_IMAGES_BUCKET, short-lived (default 1hr TTL)
 *                          Used by the vision pipeline to make base64/external
 *                          images accessible to external vision APIs via URL.
 *
 *   storeGeneratedImage  — IMAGES_BUCKET, long-lived (7-day cron cleanup)
 *                          Used by image_generate tool to persist outputs.
 *
 * Both functions return the URL/ID needed to reference the stored object,
 * or null on failure (so callers can decide whether to error or proceed).
 *
 * The cron cleanup logic that deletes expired objects lives in
 * ai/src/gateway/routes/images.ts (cleanupExpiredImages, cleanupExpiredTempImages).
 * It reads the expiresAt and createdAt metadata fields set here.
 */

import { generateR2PresignedUrl } from "../../utils/r2Signer";
import type { Env } from "../../env";
import type { ImageStorageMetadata } from "./types";
import { logger } from "../../logger";

// ---------------------------------------------------------------------------
// Temp image storage (gateway-vision-temp purpose)
// ---------------------------------------------------------------------------

/**
 * Upload image bytes to TEMP_IMAGES_BUCKET and return a presigned URL.
 *
 * The presigned URL is time-limited (default 3600s) and publicly accessible —
 * external vision APIs (Anthropic, OpenAI, Google) can fetch from it during
 * inference. After the TTL expires, the URL becomes invalid and the cron
 * cleanup removes the object from R2.
 *
 * Returns null if TEMP_IMAGES_BUCKET is not configured or upload fails.
 */
export async function storeTempImage(
  env:        Env,
  bytes:      Uint8Array,
  mimeType:   string,
  ttlSeconds  = 3600
): Promise<string | null> {
  if (!env.TEMP_IMAGES_BUCKET) {
    logger.warn("storeTempImage: TEMP_IMAGES_BUCKET not configured");
    return null;
  }

  const tempId  = crypto.randomUUID();
  const key     = `temp-images/${tempId}`;
  const now     = Date.now();

  const meta: ImageStorageMetadata = {
    purpose:   "gateway-vision-temp",
    createdAt: now.toString(),
    expiresAt: (now + ttlSeconds * 1_000).toString(),
    mimeType,
  };

  try {
    await env.TEMP_IMAGES_BUCKET.put(key, bytes, {
      httpMetadata:   { contentType: mimeType },
      customMetadata: meta as unknown as Record<string, string>,
    });
  } catch (putErr: any) {
    logger.error("storeTempImage: R2 put failed", {
      key,
      mimeType,
      error: putErr.message,
      hint:  "Ensure the TEMP_IMAGES_BUCKET binding is configured in wrangler.toml",
    });
    return null;
  }

  const presignedUrl = await generateR2PresignedUrl(env, "studio-images-temp", key, ttlSeconds);
  if (!presignedUrl) {
    logger.error("storeTempImage: presigned URL generation failed", {
      key,
      hint: "Ensure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID are set",
    });
    return null;
  }

  logger.info("storeTempImage: uploaded", { key, mimeType, bytes: bytes.length });
  return presignedUrl;
}

// ---------------------------------------------------------------------------
// Generated image storage (generated-image purpose)
// ---------------------------------------------------------------------------

/**
 * Upload a generated image to IMAGES_BUCKET for long-term serving.
 *
 * Unlike temp images, generated images are not presigned — they are served
 * via the /v1/images/:id endpoint in ai/src/gateway/routes/images.ts.
 * The cron job deletes objects older than 7 days.
 *
 * Returns the image UUID (used to construct the serving URL), or null on failure.
 */
export async function storeGeneratedImage(
  env:      Env,
  bytes:    Uint8Array,
  mimeType: string
): Promise<string | null> {
  if (!env.IMAGES_BUCKET) {
    logger.warn("storeGeneratedImage: IMAGES_BUCKET not configured");
    return null;
  }

  const imageId = crypto.randomUUID();
  const key     = `images/${imageId}`;
  const now     = Date.now();

  const meta: ImageStorageMetadata = {
    purpose:   "generated-image",
    createdAt: now.toString(),
    mimeType,
  };

  try {
    await env.IMAGES_BUCKET.put(key, bytes, {
      httpMetadata:   { contentType: mimeType },
      customMetadata: meta as unknown as Record<string, string>,
    });
    logger.info("storeGeneratedImage: uploaded", { key, mimeType, bytes: bytes.length });
    return imageId;
  } catch (e: any) {
    logger.error("storeGeneratedImage: R2 put failed", { key, error: e.message });
    return null;
  }
}
