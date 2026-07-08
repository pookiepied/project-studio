/**
 * Client-side types for image handling in Studio.
 *
 * These types describe how images are processed on the frontend before
 * being sent to the AI provider. Kept separate from the AI worker types
 * (ai/src/inputs/image/types.ts) since this layer runs in the browser/Tauri.
 *
 * Organization note:
 *   STUDIO/src/services/inputs/image/  — this module (image processing)
 *   STUDIO/src/services/inputs/audio/  — future: audio capture, STT
 *   STUDIO/src/services/inputs/video/  — future: video capture, frame extraction
 *
 * The "inputs/" layer holds all media pre-processing before messages are
 * sent to the AI. It sits between the raw user input (File/Blob/URL) and
 * the chat message builder that assembles the API request.
 */

/** Detail level hint passed to vision providers. */
export type ImageDetailLevel = "low" | "high" | "auto";

/** Result of client-side image preparation. */
export interface ProcessedImage {
  /** The (possibly compressed) File object. */
  file: File;
  /** Final size in megabytes after processing. */
  sizeMB: number;
  /** Detail level chosen for this image. */
  detail: ImageDetailLevel;
  /** Whether the image was compressed from its original size. */
  compressed: boolean;
}

/** An image source that can be analyzed by the LLM. */
export type ClientImageSource =
  | { kind: "file";    file: File }
  | { kind: "url";     url: string }
  | { kind: "dataUrl"; dataUrl: string };
