/**
 * Local model helpers.
 *
 * Model-id detection for the local_inference_required path — chatService calls
 * the daemon directly — plus the chunk decoding shared with sseStream.
 */

// ---------------------------------------------------------------------------
// Model detection helpers
// ---------------------------------------------------------------------------

export function isLocalModel(model: string): boolean {
  return (
    model.startsWith("local:") ||
    model.startsWith("ollama:") ||
    model.startsWith("lmstudio:")
  );
}

export function isFasterWhisperModel(model: string): boolean {
  return model.startsWith("faster-whisper:");
}

export function extractLocalModelName(model: string): string {
  return model.replace(/^(local:|ollama:|lmstudio:)/, "");
}

export function extractFasterWhisperModelName(model: string): string {
  return model.replace(/^faster-whisper:/, "");
}

// ---------------------------------------------------------------------------
// Chunk decoder (Tauri WebView2 compatibility)
// ---------------------------------------------------------------------------

/**
 * Normalise a ReadableStream chunk before TextDecoder.
 * In WebView2 (Tauri on Windows) SSE responses, chunks may arrive as plain
 * strings rather than Uint8Array, which causes TextDecoder.decode() to throw.
 */
export function decodeChunk(
  decoder: TextDecoder,
  value: Uint8Array | string | unknown
): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return decoder.decode(value, { stream: true });
  if (value instanceof ArrayBuffer || Array.isArray(value))
    return decoder.decode(new Uint8Array(value as ArrayBuffer), { stream: true });
  try {
    return decoder.decode(new Uint8Array(value as ArrayBuffer), { stream: true });
  } catch {
    return "";
  }
}
