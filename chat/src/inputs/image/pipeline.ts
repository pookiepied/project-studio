/**
 * Vision preprocessing pipeline.
 *
 * Applied to every incoming chat request that contains images.
 * Transforms the raw messages array so all image references become
 * presigned R2 URLs that external vision APIs can fetch during inference.
 *
 * ── Two passes ──────────────────────────────────────────────────────────────
 *
 * Pass 1 — Image upload (TEMP_IMAGES_BUCKET required):
 *   Finds image_url content parts in the last user message.
 *   Resolves each URL (data:, https:) to raw bytes via resolveImageSource().
 *   Uploads bytes to TEMP_IMAGES_BUCKET via storeTempImage().
 *   Replaces original URL with the presigned R2 URL in-place.
 *   Injects the presigned URL as a text annotation so tool calls can reference it.
 *
 * Pass 2 — URL promotion (vision-capable models only):
 *   Scans plain text in the last user message for pasted image URLs.
 *   Detects images by file extension or HEAD Content-Type check.
 *   Promotes detected URLs to image_url content parts.
 *
 * Moved from ai/src/gateway/pipeline/vision.ts as part of the
 * inputs/image/ module reorganization.
 * The old file is now a thin re-export shim for backward compatibility.
 */

import type { ChatPipelineContext } from "../../pipeline/types";
import { createErrorResponse } from "@gateway/middleware/response";
import { resolveImageSource } from "./resolver";
import { storeTempImage } from "./r2Store";
import { logger } from "../../logger";

// Image extension pattern for Pass 2 URL detection
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|bmp|avif|tiff)(\?[^\s]*)?$/i;

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export async function preprocessVision(ctx: ChatPipelineContext): Promise<Response | null> {
  const { env, messages, supportsVision } = ctx;

  // ── Pass 1: Resolve images → R2 → presigned URLs ────────────────────────
  const lastUserMsgIdx = messages.reduce<number>(
    (last, m, i) => (m.role === "user" ? i : last),
    -1
  );

  if (env.TEMP_IMAGES_BUCKET && lastUserMsgIdx >= 0) {
    const msg    = messages[lastUserMsgIdx];
    const errors: string[] = [];

    if (Array.isArray(msg.content)) {
      for (const part of msg.content as any[]) {
        if (part.type !== "image_url") continue;
        const url: string = part.image_url?.url ?? "";
        if (!url) continue;

        // Detect source kind from URL format
        const imageSource = url.startsWith("data:")
          ? { kind: "data_url"  as const, value: url }
          : url.startsWith("http://") || url.startsWith("https://")
          ? { kind: "https_url" as const, value: url }
          : null;

        if (!imageSource) {
          logger.warn("preprocessVision: unrecognized URL format, skipping", {
            urlPrefix: url.slice(0, 50),
          });
          continue;
        }

        // Resolve to bytes
        const resolved = await resolveImageSource(imageSource);
        if (!resolved) {
          logger.warn("preprocessVision: could not resolve image", { urlPrefix: url.slice(0, 80) });
          errors.push("One or more images could not be loaded. They may be too large (max 20 MB), unavailable, or in an unsupported format.");
          continue;
        }

        // Upload to R2 temp bucket
        const presignedUrl = await storeTempImage(env, resolved.bytes, resolved.mimeType, 3600);
        if (!presignedUrl) {
          const err =
            "Image upload to R2 failed. " +
            "Ensure TEMP_IMAGES_BUCKET (studio-images-temp) exists and " +
            "R2 credentials are configured (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID).";
          logger.error(err);
          errors.push(err);
          continue;
        }

        // Replace URL in-place with presigned R2 URL
        part.image_url.url = presignedUrl;

        // Inject as text annotation for tool reference
        const textPart = (msg.content as any[]).find((p: any) => p.type === "text");
        if (textPart) {
          textPart.text = `[Uploaded image URL: ${presignedUrl}]\n${textPart.text}`;
        } else {
          (msg.content as any[]).unshift({
            type: "text",
            text: `[Uploaded image URL: ${presignedUrl}]`,
          });
        }

        if (!ctx.visionSubstitutions) ctx.visionSubstitutions = [];
        ctx.visionSubstitutions.push({ presignedUrl });

        logger.info("preprocessVision: image uploaded and URL substituted", {
          mimeType: resolved.mimeType,
          bytes:    resolved.size,
        });
      }
    }

    if (errors.length > 0) {
      return createErrorResponse(
        `Image processing failed: ${errors.join("; ")}. ` +
        `Ensure: (1) R2 bucket 'studio-images-temp' exists in Cloudflare, ` +
        `(2) R2 API credentials are set via wrangler secret put.`,
        400,
        "image_conversion_error"
      );
    }
  }

  // ── Pass 2: Promote pasted image URLs in plain text → image_url parts ───
  if (supportsVision) {
    const lastUserIdx = messages.reduce((last, m, i) => (m.role === "user" ? i : last), -1);
    if (lastUserIdx >= 0) {
      const lastMsg = messages[lastUserIdx];

      if (typeof lastMsg.content === "string") {
        lastMsg.content = [{ type: "text", text: lastMsg.content }];
      }

      if (Array.isArray(lastMsg.content)) {
        const existingUrls = new Set(
          (lastMsg.content as any[])
            .filter((p: any) => p.type === "image_url")
            .map((p: any) => p.image_url?.url ?? "")
        );

        const textPart = (lastMsg.content as any[]).find((p: any) => p.type === "text");
        if (textPart?.text) {
          const urlRegex  = /https?:\/\/[^\s<>"'`\]\)]+/g;
          const foundUrls = (textPart.text as string).match(urlRegex) ?? [];

          for (const url of foundUrls) {
            if (existingUrls.has(url)) continue;

            // Check if it's an image by extension first, then by HEAD Content-Type
            let isImage = IMAGE_EXT_RE.test(url.split("?")[0]);
            if (!isImage) {
              try {
                const head = await fetch(url, { method: "HEAD" });
                isImage    = (head.headers.get("content-type") ?? "").startsWith("image/");
              } catch { /* unreachable or non-image — skip */ }
            }

            if (isImage) {
              (lastMsg.content as any[]).push({
                type:      "image_url",
                image_url: { url, detail: "auto" },
              });
              existingUrls.add(url);
              logger.info("preprocessVision: promoted pasted URL to image_url", {
                url: url.slice(0, 100),
              });
            }
          }
        }
      }
    }
  }

  return null;
}
