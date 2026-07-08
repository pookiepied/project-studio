/**
 * Shared types for the Computer Use vision module.
 *
 * These types describe the MCP content format returned by vision tools.
 * The MCP protocol supports returning mixed content arrays — text + image.
 * Vision tools use this to return both image data and metadata in one call,
 * so the LLM receives actual pixels to analyze alongside structured metadata.
 *
 * Format contract:
 *   vision tools → return McpContent[] directly from dispatch()
 *   index.ts     → detects McpContent[] via isContentArray() and passes through
 *   MCP client   → receives { type: "image", data, mimeType } content items
 *   extractMcpImages() → extracts data URLs for injection into AI messages
 */

/** MCP image content item — base64-encoded pixel data for direct LLM vision. */
export interface McpImageContent {
  type: "image";
  /** Base64-encoded image bytes (no data: prefix). */
  data: string;
  /** MIME type: "image/png", "image/jpeg", "image/gif", "image/webp", etc. */
  mimeType: string;
}

/** MCP text content item — structured metadata or error messages. */
export interface McpTextContent {
  type: "text";
  text: string;
}

/** Union of all content types a vision tool can return. */
export type McpContent = McpImageContent | McpTextContent;

/** Return value from image loading operations. */
export interface LoadResult {
  /** Whether the load succeeded. */
  ok: boolean;
  /** Base64 image content — present when ok === true. */
  content?: McpImageContent;
  /** File size in bytes. */
  bytes?: number;
  /** Error message — present when ok === false. */
  error?: string;
}
