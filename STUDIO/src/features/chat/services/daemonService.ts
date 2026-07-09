/**
 * Local model daemon streaming.
 *
 * Handles the local_inference_required path: the cloud worker assembles the
 * full context (system prompt + memories + tools) and signals the client to
 * run the actual LLM inference against a local Ollama / LM Studio daemon.
 */

import { logger } from "@/core/logging/logger";
import { reportLocalUsage, type LocalUsage } from "@/features/models/services/localUsageService";

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

// ---------------------------------------------------------------------------
// Daemon streaming
// ---------------------------------------------------------------------------

interface LocalInferencePayload {
  model: string;
  messages: unknown[];
  tools?: unknown[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Stream directly from the local daemon after the cloud worker returns a
 * `local_inference_required` payload with the assembled context.
 */
export async function* daemonStream(
  payload: LocalInferencePayload,
  daemonPort: number,
  temperature: number,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const startedAt = Date.now();
  const response = await fetch(
    `http://localhost:${daemonPort}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        tools: payload.tools,
        stream: true,
        stream_options: { include_usage: true },
        temperature,
      }),
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`Daemon returned HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Daemon: no response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let usage: LocalUsage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decodeChunk(decoder, value);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        // Final chunk (stream_options.include_usage) carries usage with empty choices.
        if (parsed.usage) usage = parsed.usage;
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        logger.warn("daemonService", "Failed to parse daemon chunk", { line });
      }
    }
  }

  // Report local usage once the stream completes (model may be bare → engine "local").
  reportLocalUsage({ model: payload.model, startedAt, usage });
}
