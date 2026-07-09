/**
 * Frontend Vision Service
 *
 * High-level API for preparing images before sending them to the AI.
 * Provides a clean single-call interface over the lower-level imageUtils.ts
 * compression primitives.
 *
 * This service is the right place to add future client-side vision features:
 *   - Image format detection (detect screenshot vs photo vs diagram)
 *   - Automatic pre-cropping / region selection
 *   - Client-side OCR (Tesseract.js) for offline text extraction
 *   - Preview thumbnail generation for the attachment UI
 */

import {
  arrayBufferToBase64,
  compressLargeImageForProvider,
  compressImageForMultiAttachment,
  pickImageDetail,
} from "./imageUtils";
import type { ProcessedImage } from "./types";

// ---------------------------------------------------------------------------
// Image preparation for AI requests
// ---------------------------------------------------------------------------

/**
 * Prepare a single image File for sending to an AI vision provider.
 *
 * Steps:
 *   1. Compress if above provider payload limit
 *   2. Pick detail level (low/high/auto) based on size and context
 *   3. Return the processed File + metadata
 */
export async function prepareImageForProvider(
  file:             File,
  hasMultipleImages = false
): Promise<ProcessedImage> {
  const originalSizeMB = file.size / (1024 * 1024);

  let processed  = file;
  let compressed = false;

  if (hasMultipleImages) {
    processed  = await compressImageForMultiAttachment(file);
    compressed = processed !== file;
  } else if (file.size > 1.5 * 1024 * 1024) {
    processed  = await compressLargeImageForProvider(file, originalSizeMB);
    compressed = processed !== file;
  }

  const finalSizeMB = processed.size / (1024 * 1024);
  const detail      = pickImageDetail(finalSizeMB, hasMultipleImages);

  return { file: processed, sizeMB: finalSizeMB, detail, compressed };
}

/**
 * Prepare multiple image Files for a multi-image vision request.
 * Applies the lighter multi-attachment compression to each.
 */
export async function prepareImagesForProvider(files: File[]): Promise<ProcessedImage[]> {
  return Promise.all(files.map((f) => prepareImageForProvider(f, files.length > 1)));
}

// ---------------------------------------------------------------------------
// Data URL conversion
// ---------------------------------------------------------------------------

/**
 * Convert a File to a base64 data URL string.
 * Use this when the AI API expects a data:image/...;base64,... string.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = await arrayBufferToBase64(buffer);
  return `data:${file.type};base64,${base64}`;
}

/**
 * Convert a File to { base64, mimeType } without the data: prefix.
 * Use when the API expects raw base64 separately from the MIME type.
 */
export async function fileToBase64Parts(file: File): Promise<{ base64: string; mimeType: string }> {
  const buffer = await file.arrayBuffer();
  const base64 = await arrayBufferToBase64(buffer);
  return { base64, mimeType: file.type || "image/jpeg" };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Estimate whether an image at a given size would benefit from compression
 * before being sent to a vision provider.
 */
export function shouldCompress(file: File): boolean {
  return file.size > 1.5 * 1024 * 1024; // > 1.5 MB
}
