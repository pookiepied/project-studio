/**
 * Shared types for the Studio image / vision layer.
 *
 * This is the single source of truth for all image-related types in the
 * AI worker. Import from here — never define image types in individual files.
 *
 * Organization note:
 *   ai/src/inputs/image/  — this module
 *   ai/src/inputs/audio/  — future: audio transcription, TTS types
 *   ai/src/inputs/video/  — future: video analysis, generation types
 *   ai/src/inputs/text/   — future: text processing, chunking types
 *
 * The "inputs/" layer holds cross-cutting media-processing concerns that
 * sit between the raw HTTP gateway and the tool/orchestration layer.
 */

// ── Image source descriptors ─────────────────────────────────────────────────

/**
 * All the ways an image can arrive in the Studio system.
 *
 * The resolver (resolver.ts) converts any of these into a ResolvedImage.
 * Add new variants here when a new image source type is introduced —
 * the resolver is the only place that needs updating.
 */
export type ImageSource =
  /** A data:image/...;base64,... URL (typically from chat uploads). */
  | { kind: "data_url";  value: string }
  /** An https:// URL — external CDN, R2 presigned URL, or internal asset. */
  | { kind: "https_url"; value: string }
  /** A direct reference to an R2 bucket object. */
  | { kind: "r2_key";    bucket: R2Bucket; key: string }
  /** Raw base64 string without the data: prefix. */
  | { kind: "base64";    data: string; mimeType: string }
  /** Already-decoded binary data. */
  | { kind: "raw_bytes"; bytes: Uint8Array; mimeType: string };

/**
 * The canonical, fully-resolved form of an image ready for use
 * by the vision pipeline, R2 storage, or tool execution.
 */
export interface ResolvedImage {
  /** Raw binary image data. */
  bytes:    Uint8Array;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
  /** Byte count — same as bytes.length, kept for convenience. */
  size:     number;
}

// ── Vision pipeline types ────────────────────────────────────────────────────

/**
 * Result of the vision preprocessing pipeline for a single request.
 */
export interface VisionPreprocessResult {
  /** True if the pipeline modified the messages array. */
  modified:      boolean;
  /** Presigned R2 URLs injected for tool reference in this request. */
  presignedUrls: string[];
  /** Non-fatal warnings accumulated during processing. */
  warnings:      string[];
}

// ── R2 storage types ─────────────────────────────────────────────────────────

/**
 * Custom metadata stored alongside each uploaded image in R2.
 * Allows cron cleanup and provenance tracking without extra DB queries.
 */
export interface ImageStorageMetadata {
  /** Where this image came from. */
  purpose:    "gateway-vision-temp" | "generated-image";
  /** Unix timestamp (ms) when this object was created. */
  createdAt:  string;
  /** Unix timestamp (ms) after which this object should be deleted. */
  expiresAt?: string;
  /** MIME type of the stored image. */
  mimeType:   string;
  /** Original source URL, if the image was fetched from a remote URL. */
  sourceUrl?: string;
}
