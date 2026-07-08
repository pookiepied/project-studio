/**
 * Studio client-side image / vision service.
 *
 * Single import point for all image-related client code in Studio.
 * This module consolidates what was previously in services/ai/imageUtils.ts.
 *
 * ── Module map ───────────────────────────────────────────────────────────────
 *
 *   types.ts          — ImageDetailLevel, ProcessedImage, ClientImageSource
 *
 *   imageUtils.ts     — Low-level primitives:
 *                         arrayBufferToBase64()
 *                         compressLargeImageForProvider()
 *                         compressImageForMultiAttachment()
 *                         pickImageDetail()
 *
 *   visionService.ts  — High-level API:
 *                         prepareImageForProvider()    (single image)
 *                         prepareImagesForProvider()   (batch)
 *                         fileToDataUrl()
 *                         fileToBase64Parts()
 *                         shouldCompress()
 *
 * ── Sibling modules (planned) ────────────────────────────────────────────────
 *
 *   STUDIO/src/services/inputs/audio/  — audio capture, STT, waveform rendering
 *   STUDIO/src/services/inputs/video/  — video capture, frame extraction
 *   STUDIO/src/services/inputs/text/   — paste detection, token estimation
 */

// Types
export type { ImageDetailLevel, ProcessedImage, ClientImageSource } from "./types";

// Low-level utilities
export {
  arrayBufferToBase64,
  compressLargeImageForProvider,
  compressImageForMultiAttachment,
  pickImageDetail,
} from "./imageUtils";

// High-level service API
export {
  prepareImageForProvider,
  prepareImagesForProvider,
  fileToDataUrl,
  fileToBase64Parts,
  shouldCompress,
} from "./visionService";
