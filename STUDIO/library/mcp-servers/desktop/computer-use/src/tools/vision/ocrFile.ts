/**
 * ocrFile / ocrUrl — extract text from image files or URLs using Windows OCR.
 *
 * Extends the existing ocr_screen capability to work on arbitrary images:
 *   ocr_file(path) — OCR any image file on the local filesystem
 *   ocr_url(url)   — fetch an image URL, write to temp, OCR it, then clean up
 *
 * Uses Windows.Media.Ocr.OcrEngine (Windows 10/11 native OCR).
 * Supports 25+ languages via BCP-47 tags. Requires a Windows language pack.
 *
 * Returns the same shape as ocr_screen:
 *   { success, text (full string), lines[], language (detected BCP-47 tag) }
 */

import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { runPSMTA } from "../desktop/ps-helper.js";
import { fetchImageFromUrl } from "./imageLoader.js";

// ---------------------------------------------------------------------------
// OCR PowerShell template
// ---------------------------------------------------------------------------

function buildOcrScript(psPath: string, language: string | undefined): string {
  const langScript = language
    ? `  $lang   = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]::new('${language}')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)`
    : `  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()`;

  return `
[Windows.Media.Ocr.OcrEngine,            Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,            Windows.Storage,    ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode,         Windows.Storage,    ContentType=WindowsRuntime] | Out-Null
try {
${langScript}
  if (-not $engine) { throw "OCR engine unavailable — install a Windows language pack first (Settings > Time & Language > Language & Region)" }

  $file    = [Windows.Storage.StorageFile]::GetFileFromPathAsync('${psPath}').GetAwaiter().GetResult()
  $stream  = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read).GetAwaiter().GetResult()
  $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).GetAwaiter().GetResult()
  $softBmp = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
  $result  = $engine.RecognizeAsync($softBmp).GetAwaiter().GetResult()
  $stream.Dispose()

  $lines    = $result.Lines | ForEach-Object { [PSCustomObject]@{ text = $_.Text } }
  $fullText = ($result.Lines | ForEach-Object { $_.Text }) -join "\`n"

  [PSCustomObject]@{
    success  = $true
    text     = $fullText
    lines    = @($lines)
    language = $result.DetectedLanguage.LanguageTag
    path     = '${psPath}'
  } | ConvertTo-Json -Depth 3
} catch {
  [PSCustomObject]@{ success = $false; error = $_.Exception.Message } | ConvertTo-Json
}`;
}

// ---------------------------------------------------------------------------
// ocr_file
// ---------------------------------------------------------------------------

/**
 * Extract text from a local image file using Windows OCR.
 */
export async function ocrFile(args: Record<string, unknown>): Promise<unknown> {
  const rawPath  = (args.path as string | undefined)?.trim();
  const language = (args.language as string | undefined)?.replace(/['"]/g, "");

  if (!rawPath) {
    return { error: "path is required — provide the absolute path to the image file" };
  }

  const abs = path.resolve(rawPath.replace(/^["']|["']$/g, ""));
  if (!fs.existsSync(abs)) {
    return { error: `File not found: ${abs}. Use glob or ls to verify the path.` };
  }

  // Escape single quotes for PowerShell string literal
  const psPath = abs.replace(/'/g, "''");
  return runPSMTA(buildOcrScript(psPath, language), 30_000);
}

// ---------------------------------------------------------------------------
// ocr_url
// ---------------------------------------------------------------------------

/** MIME type → file extension for temp file naming */
const MIME_EXT: Record<string, string> = {
  "image/png":  ".png",
  "image/jpeg": ".jpg",
  "image/bmp":  ".bmp",
  "image/gif":  ".gif",
  "image/tiff": ".tif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/**
 * Fetch an image from a URL, write to a temp file, OCR it, then clean up.
 * Combines HTTP fetch + file-based OCR into one call for URL image sources.
 */
export async function ocrUrl(args: Record<string, unknown>): Promise<unknown> {
  const url      = (args.url as string | undefined)?.trim();
  const language = args.language;

  if (!url) {
    return { error: "url is required" };
  }

  const loaded = await fetchImageFromUrl(url);
  if (!loaded.ok || !loaded.content) {
    return { error: `Failed to fetch image from URL: ${loaded.error}` };
  }

  const ext      = MIME_EXT[loaded.content.mimeType] ?? ".png";
  const tempPath = path.join(os.tmpdir(), `studio-ocr-url-${Date.now()}${ext}`);

  try {
    const buf = Buffer.from(loaded.content.data, "base64");
    fs.writeFileSync(tempPath, buf);
    return await ocrFile({ path: tempPath, language });
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
  }
}
