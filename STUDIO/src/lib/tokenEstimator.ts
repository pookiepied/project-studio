/**
 * Token counting utilities.
 *
 * Uses js-tiktoken — a pure-JavaScript port of OpenAI's tiktoken with no
 * WASM dependency. Works in Vite, Tauri WebView, and any browser environment
 * without any build-tool plugins.
 *
 * Encoding: cl100k_base (GPT-4, GPT-3.5-turbo, Claude, Gemini, most modern
 * models). Close enough for context-window budgeting on other model families.
 *
 * Fallback: If js-tiktoken throws for any reason (e.g. unusual Unicode), the
 * functions fall back to the `length / 4` heuristic transparently.
 */

import { getEncoding, type TiktokenEncoding } from "js-tiktoken";

// ---------------------------------------------------------------------------
// Encoder singleton — synchronous, created once, reused for all calls
// ---------------------------------------------------------------------------

let _encoder: ReturnType<typeof getEncoding> | null = null;

function getEncoder(): ReturnType<typeof getEncoding> | null {
  if (_encoder) return _encoder;
  try {
    _encoder = getEncoding("cl100k_base" as TiktokenEncoding);
  } catch {
    // js-tiktoken failed for some reason — fall back to heuristic
    _encoder = null;
  }
  return _encoder;
}

// Initialise eagerly so the first call is instant
getEncoder();

// ---------------------------------------------------------------------------
// Core counting functions
// ---------------------------------------------------------------------------

/**
 * Count tokens for a text string using tiktoken.
 * Falls back to `ceil(length / 4)` if the encoder is unavailable.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch {
      // Unusual unicode — fall through to heuristic
    }
  }
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens for an array of messages.
 * Includes ~4 token overhead per message for role/formatting, matching the
 * formula used by the OpenAI API.
 */
export function countMessageTokens(
  messages: { content: string | unknown }[]
): number {
  let total = 0;
  for (const msg of messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    total += countTokens(text) + 4;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Async shims — kept for backward-compatibility with ChatContext callers
// that were written against the async API. They resolve synchronously.
// ---------------------------------------------------------------------------

export async function countTokensAsync(text: string): Promise<number> {
  return countTokens(text);
}

export async function countMessageTokensAsync(
  messages: { content: string | unknown }[]
): Promise<number> {
  return countMessageTokens(messages);
}

// ---------------------------------------------------------------------------
// Legacy synchronous estimate — kept so existing callers compile unchanged
// ---------------------------------------------------------------------------

/**
 * Synchronous heuristic estimate (`ceil(length / 4)`).
 * Prefer `countTokens()` for accuracy; use this only where the tiktoken
 * singleton cannot be accessed (e.g. inside a pure reducer).
 *
 * @deprecated Use `countTokens()` instead.
 */
export function estimateTokens(text: string): number {
  return countTokens(text);
}

export function estimateMessageTokens(messages: { content: string }[]): number {
  return countMessageTokens(messages);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function isEncoderReady(): boolean {
  return _encoder !== null;
}

export function tokensToWords(tokens: number): number {
  return Math.floor(tokens / 1.3);
}

export function wordsToTokens(words: number): number {
  return Math.ceil(words * 1.3);
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`;
  return `${(tokens / 1000).toFixed(1)}K tokens`;
}

export function getTokenWarning(
  currentTokens: number,
  maxTokens: number
): { level: "none" | "info" | "warning" | "critical"; message: string | null } {
  const percentage = maxTokens > 0 ? (currentTokens / maxTokens) * 100 : 0;

  if (percentage > 90) {
    return {
      level: "critical",
      message: "Conversation is very long. Consider starting a new chat.",
    };
  }
  if (percentage > 75) {
    return {
      level: "warning",
      message: "Conversation is getting long. Older messages may be dropped.",
    };
  }
  if (percentage > 50) {
    return {
      level: "info",
      message: "Long conversation — context is being managed automatically.",
    };
  }
  return { level: "none", message: null };
}
