/**
 * Studio image / vision processing layer.
 *
 * This module is the single import point for all image-related functionality
 * in the AI worker. It consolidates what was previously scattered across:
 *   - ai/src/gateway/pipeline/vision.ts  (pipeline → now in pipeline.ts)
 *   - ai/src/gateway/routes/images.ts    (R2 helpers → now in r2Store.ts)
 *   - various tools that each resolved images independently
 *
 * ── Module map ───────────────────────────────────────────────────────────────
 *
 *   types.ts     — ImageSource, ResolvedImage, VisionPreprocessResult,
 *                  ImageStorageMetadata
 *
 *   resolver.ts  — resolveImageSource(source) → ResolvedImage | null
 *                  detectImageSource(url) → ImageSource | null
 *
 *   r2Store.ts   — storeTempImage(env, bytes, mimeType, ttl) → presignedUrl | null
 *                  storeGeneratedImage(env, bytes, mimeType) → imageId | null
 *
 *   pipeline.ts  — preprocessVision(ctx) → Response | null
 *                  (the gateway preprocessing step — unchanged API)
 *
 * ── Future additions ─────────────────────────────────────────────────────────
 *
 *   analyze.ts   — cloud-side image analysis (OCR, classification, captioning)
 *                  when supported via Workers AI or external vision APIs
 *
 * ── Sibling modules (planned) ────────────────────────────────────────────────
 *
 *   ai/src/inputs/audio/  — TTS, STT, audio transcription
 *   ai/src/inputs/video/  — video generation, frame extraction
 *   ai/src/inputs/text/   — chunking, token counting, context pruning
 */

// Types
export type {
  ImageSource,
  ResolvedImage,
  VisionPreprocessResult,
  ImageStorageMetadata,
} from "./types";

// Resolution
export { resolveImageSource, detectImageSource } from "./resolver";

// R2 storage
export { storeTempImage, storeGeneratedImage } from "./r2Store";

// Gateway pipeline
export { preprocessVision } from "./pipeline";
