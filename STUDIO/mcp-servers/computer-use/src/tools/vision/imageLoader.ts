/**
 * imageLoader — Node.js image loading utilities for the vision module.
 *
 * Provides two primitives that all vision tools build on:
 *   loadImageFromFile  — local file path → base64 MCP content
 *   fetchImageFromUrl  — http/https URL  → base64 MCP content
 *
 * Both return a structured LoadResult — they never throw.
 * Callers can rely on ok === false having a descriptive error string
 * the LLM can act on (e.g. "File not found: try glob first").
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import type { LoadResult, McpImageContent } from "./types.js";

// ---------------------------------------------------------------------------
// MIME type resolution
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".bmp":  "image/bmp",
  ".tiff": "image/tiff",
  ".tif":  "image/tiff",
  ".avif": "image/avif",
  ".ico":  "image/x-icon",
};

function mimeFromExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "image/png";
}

// ---------------------------------------------------------------------------
// Size guard — prevents OOM on accidental large-file loads
// ---------------------------------------------------------------------------

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Local file loader
// ---------------------------------------------------------------------------

/**
 * Load an image from a local file path and return base64 MCP content.
 *
 * Strips surrounding quotes (PowerShell often wraps paths in single quotes).
 * Resolves relative paths against the process cwd.
 */
export function loadImageFromFile(filePath: string): LoadResult {
  try {
    const cleaned = filePath.replace(/^["']|["']$/g, "").trim();
    const abs     = path.resolve(cleaned);

    if (!fs.existsSync(abs)) {
      return {
        ok:    false,
        error: `File not found: ${abs}. Use glob or ls to verify the path exists first.`,
      };
    }

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return { ok: false, error: `Path is a directory, not a file: ${abs}` };
    }
    if (stat.size > MAX_BYTES) {
      return {
        ok:    false,
        error: `Image too large (${Math.round(stat.size / 1_048_576)} MB). Maximum is 20 MB.`,
      };
    }

    const buf      = fs.readFileSync(abs);
    const ext      = path.extname(abs);
    const mimeType = mimeFromExt(ext);
    const data     = buf.toString("base64");

    const content: McpImageContent = { type: "image", data, mimeType };
    return { ok: true, content, bytes: buf.length };
  } catch (e: any) {
    return { ok: false, error: `Failed to load image file: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// URL fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch an image from an HTTP/HTTPS URL and return base64 MCP content.
 *
 * Supports: public URLs, presigned R2 URLs, CDN links, internal asset URLs.
 * Does NOT support: local file:// paths (use loadImageFromFile for those).
 *
 * @param url         Target URL — must start with http:// or https://
 * @param timeoutMs   Abort timeout in milliseconds (default 20 seconds)
 */
export async function fetchImageFromUrl(url: string, timeoutMs = 20_000): Promise<LoadResult> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      ok:    false,
      error: `Invalid URL format — must begin with http:// or https://. Got: ${url.slice(0, 80)}`,
    };
  }

  try {
    const controller = new AbortController();
    const tid        = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(tid);
    }

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} fetching ${url.slice(0, 120)}` };
    }

    // Check Content-Length before reading the full body
    const clHeader = response.headers.get("content-length");
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (!isNaN(cl) && cl > MAX_BYTES) {
        return { ok: false, error: `Remote image too large (${Math.round(cl / 1_048_576)} MB). Maximum is 20 MB.` };
      }
    }

    const ct       = response.headers.get("content-type") ?? "image/jpeg";
    const mimeType = ct.split(";")[0].trim();
    const buf      = await response.arrayBuffer();

    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: `Image too large after download (${Math.round(buf.byteLength / 1_048_576)} MB). Maximum is 20 MB.` };
    }

    const data: string = Buffer.from(buf).toString("base64");
    return {
      ok:      true,
      content: { type: "image", data, mimeType },
      bytes:   buf.byteLength,
    };
  } catch (e: any) {
    const msg = e?.name === "AbortError"
      ? `Timed out fetching image after ${timeoutMs / 1000}s — URL may be slow or unreachable`
      : `Failed to fetch image: ${e.message}`;
    return { ok: false, error: msg };
  }
}
