/**
 * Image source resolver — converts any ImageSource variant to raw bytes.
 *
 * This is the single entry point for resolving image data in the AI worker.
 * All vision code (pipeline, tools, generation helpers) should call
 * resolveImageSource() rather than directly inspecting URL formats.
 *
 * Supported sources:
 *   data_url   — base64-encoded data URI (chat uploads)
 *   https_url  — fetch from remote URL (external CDNs, R2 presigned, internal)
 *   r2_key     — direct R2 bucket.get() call (internal references)
 *   base64     — raw base64 string with explicit MIME type
 *   raw_bytes  — already-decoded Uint8Array (no-op pass-through)
 */

import type { ImageSource, ResolvedImage } from "./types";
import { logger } from "../../logger";
import { MAX_IMAGE_BYTES } from "../../constants";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function checkSize(bytes: Uint8Array, kind: string): Uint8Array | null {
  if (bytes.length > MAX_IMAGE_BYTES) {
    logger.warn("resolveImageSource: image exceeds 20 MB size limit", {
      kind,
      sizeMB: (bytes.length / (1024 * 1024)).toFixed(1),
    });
    return null;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve any ImageSource into raw bytes + MIME type.
 *
 * Returns null on failure — never throws.
 * Callers should treat null as "image unavailable" and emit a warning.
 */
export async function resolveImageSource(source: ImageSource): Promise<ResolvedImage | null> {
  try {
    switch (source.kind) {

      case "data_url": {
        const commaIdx = source.value.indexOf(",");
        if (commaIdx === -1) {
          logger.warn("resolveImageSource: malformed data URL (no comma)", {
            prefix: source.value.slice(0, 40),
          });
          return null;
        }
        const mimeType = source.value.slice(5, commaIdx).split(";")[0] || "image/jpeg";
        const bytes    = checkSize(decodeBase64ToBytes(source.value.slice(commaIdx + 1)), "data_url");
        if (!bytes) return null;
        return { bytes, mimeType, size: bytes.length };
      }

      case "base64": {
        const bytes = checkSize(decodeBase64ToBytes(source.data), "base64");
        if (!bytes) return null;
        return { bytes, mimeType: source.mimeType, size: bytes.length };
      }

      case "raw_bytes": {
        return { bytes: source.bytes, mimeType: source.mimeType, size: source.bytes.length };
      }

      case "https_url": {
        const response = await fetch(source.value);
        if (!response.ok) {
          logger.warn("resolveImageSource: https_url fetch failed", {
            status: response.status,
            url:    source.value.slice(0, 80),
          });
          return null;
        }
        const mimeType = (response.headers.get("content-type") ?? "image/jpeg")
          .split(";")[0]
          .trim();
        const bytes = checkSize(new Uint8Array(await response.arrayBuffer()), "https_url");
        if (!bytes) return null;
        return { bytes, mimeType, size: bytes.length };
      }

      case "r2_key": {
        const obj = await source.bucket.get(source.key);
        if (!obj) {
          logger.warn("resolveImageSource: R2 object not found", { key: source.key });
          return null;
        }
        const mimeType = obj.httpMetadata?.contentType ?? "image/jpeg";
        const bytes    = checkSize(new Uint8Array(await obj.arrayBuffer()), "r2_key");
        if (!bytes) return null;
        return { bytes, mimeType, size: bytes.length };
      }
    }
  } catch (e: any) {
    logger.error("resolveImageSource: unexpected error", {
      kind:  (source as any).kind,
      error: e.message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether a string is a data URL or an https URL and return
 * the appropriate ImageSource discriminant.
 *
 * Returns null for strings that are not recognizable image URL formats.
 * Used by the vision pipeline when inspecting raw URL strings.
 */
export function detectImageSource(url: string): ImageSource | null {
  if (url.startsWith("data:"))    return { kind: "data_url",  value: url };
  if (url.startsWith("https://")) return { kind: "https_url", value: url };
  if (url.startsWith("http://"))  return { kind: "https_url", value: url };
  return null;
}
