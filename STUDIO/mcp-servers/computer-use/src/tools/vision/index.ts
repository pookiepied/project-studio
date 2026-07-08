/**
 * Vision module — single entry point for all image-related MCP tools.
 *
 * Tools exported here are the unified vision layer for Computer Use.
 * They resolve the fundamental gap: screenshot tools save PNGs to disk but the
 * LLM only ever saw the file path. This module gives the LLM actual pixels.
 *
 * ── New tools (image content → LLM vision) ────────────────────────────────
 *
 *   screenshot_and_analyze   Capture screen → return image content (primary "see" tool)
 *   analyze_image            Load image file → return image content
 *   ocr_file                 OCR any local image file
 *   ocr_url                  Fetch URL + OCR it
 *
 * ── Utilities (used by tools above) ──────────────────────────────────────
 *
 *   loadImageFromFile        Node.js file path → base64 LoadResult
 *   fetchImageFromUrl        HTTP/HTTPS URL → base64 LoadResult
 *
 * ── Types ─────────────────────────────────────────────────────────────────
 *
 *   McpContent               Union of McpImageContent | McpTextContent
 *   McpImageContent          { type:"image", data:string, mimeType:string }
 *   McpTextContent           { type:"text", text:string }
 *   LoadResult               { ok, content?, bytes?, error? }
 */

// Tools
export { analyzeImage }         from "./analyzeImage.js";
export { ocrFile, ocrUrl }      from "./ocrFile.js";
export { screenshotAndAnalyze } from "./screenshotAndAnalyze.js";

// Utilities
export { loadImageFromFile, fetchImageFromUrl } from "./imageLoader.js";

// Types
export type {
  McpContent,
  McpImageContent,
  McpTextContent,
  LoadResult,
} from "./types.js";
