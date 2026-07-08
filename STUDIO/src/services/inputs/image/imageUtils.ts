/**
 * Image compression utilities.
 *
 * Handles client-side image processing before sending to AI vision providers.
 * Moved from STUDIO/src/services/ai/imageUtils.ts as part of the
 * inputs/image/ module reorganization.
 *
 * Two compression strategies based on context:
 *
 *   compressLargeImageForProvider  — aggressive downscaling for single large images
 *                                    (> 1.5 MB → JPEG 0.8, > 4 MB → max 800 px)
 *
 *   compressImageForMultiAttachment — lighter pass for multi-image payloads
 *                                     (all images → max 800 px, JPEG 0.7)
 *
 * The goal is to stay within provider payload limits while preserving enough
 * detail for accurate vision analysis.
 */

import type { ImageDetailLevel } from "./types";

// ---------------------------------------------------------------------------
// Base64 conversion
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer to a base64 string using FileReader.
 * Returns the base64 portion only (without the data: prefix).
 */
export async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const blob   = new Blob([buffer]);
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",", 2)[1]);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Single-image compression
// ---------------------------------------------------------------------------

/**
 * Aggressively compress a single image that exceeds the provider's payload limit.
 *
 * Targets ≤ 1.5 MB final size.
 * Images over 4 MB are scaled to fit within 800 px on the longest side.
 * Images between 1.5 MB and 4 MB are scaled to 1024 px.
 * Final encoding: JPEG at quality 0.8.
 */
export async function compressLargeImageForProvider(
  file:   File,
  sizeMB: number
): Promise<File> {
  const MAX_TARGET_SIZE = 1.5 * 1024 * 1024;
  if (file.size <= MAX_TARGET_SIZE) return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img    = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;

        if (sizeMB > 4) {
          const ratio = Math.min(800 / width, 800 / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        } else if (width > 1024 || height > 1024) {
          const ratio = Math.min(1024 / width, 1024 / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file),
          "image/jpeg",
          0.8
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Multi-image compression
// ---------------------------------------------------------------------------

/**
 * Lighter compression pass for multi-image requests.
 *
 * Scales all images to ≤ 800 px on the longest side.
 * Encodes as JPEG at quality 0.7 to keep the total payload manageable.
 */
export async function compressImageForMultiAttachment(file: File): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file),
          "image/jpeg",
          0.7
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Detail level picker
// ---------------------------------------------------------------------------

/**
 * Choose the appropriate vision detail level based on image size and context.
 *
 * Detail levels affect token usage and analysis quality:
 *   "low"  — faster, cheaper, ~65 tokens per image; coarser analysis
 *   "high" — slower, richer, up to 1085 tokens per image; fine-grained detail
 *   "auto" — provider decides based on image content
 */
export function pickImageDetail(
  finalSizeMB:       number,
  hasMultipleImages: boolean
): ImageDetailLevel {
  if (hasMultipleImages) return "low";   // keep multi-image batches cheap
  if (finalSizeMB > 2)   return "low";   // large images → low to avoid token explosion
  if (finalSizeMB > 1)   return "auto";  // medium images → let the provider decide
  return "high";                         // small images → full detail
}
