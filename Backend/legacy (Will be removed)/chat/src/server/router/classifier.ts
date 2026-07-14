/**
 * Tier classifier.
 *
 * Uses conversation state signals only — no LLM call, zero latency.
 *
 * Signal priority (highest → lowest):
 *   1. Context token count (long context → advanced/extreme)
 *   2. Tool rounds completed (many tool rounds → advanced)
 *   3. First message → always standard (never simple; we want a capable model
 *      for the opening of every conversation)
 *   4. Keyword floor on the latest user message → floor to standard
 *   5. Very short latest message with no keywords → simple
 */

import { Tier, ClassifyInput } from "@gateway/services/router/types";
import {
  TOOL_ROUNDS_COMPLEX_THRESHOLD,
  TOOL_ROUNDS_ADVANCED_THRESHOLD,
  CONTEXT_TOKENS_ADVANCED_THRESHOLD,
  CONTEXT_TOKENS_EXTREME_THRESHOLD,
  STANDARD_FLOOR_KEYWORDS,
} from "@gateway/services/router/config";

/** Rough token estimate: 1 token ≈ 4 chars. */
function estimateTokens(messages: ClassifyInput["messages"]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as any[]) {
        if (typeof part?.text === "string") chars += part.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

/** Count completed tool rounds: each assistant message that has tool_calls. */
function countToolRounds(messages: ClassifyInput["messages"]): number {
  return messages.filter(
    (m) => m.role === "assistant" && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0
  ).length;
}

/** Extract the latest user message text (lowercased). */
function latestUserText(messages: ClassifyInput["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content.toLowerCase();
    if (Array.isArray(m.content)) {
      const parts = m.content as any[];
      return parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join(" ")
        .toLowerCase();
    }
  }
  return "";
}

export function classifyRequest(input: ClassifyInput): Tier {
  const { messages } = input;

  const contextTokens = estimateTokens(messages);
  const toolRounds = countToolRounds(messages);

  // --- Context size overrides (highest priority) ---
  if (contextTokens >= CONTEXT_TOKENS_EXTREME_THRESHOLD) return "extreme";
  if (contextTokens >= CONTEXT_TOKENS_ADVANCED_THRESHOLD || toolRounds >= TOOL_ROUNDS_ADVANCED_THRESHOLD) {
    return "advanced";
  }

  // --- First real message: default to standard ---
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length <= 1) return "standard";

  // --- Tool usage upgrades ---
  if (toolRounds >= TOOL_ROUNDS_COMPLEX_THRESHOLD) return "complex";

  // --- Keyword floor ---
  const text = latestUserText(messages);
  const hasKeyword = STANDARD_FLOOR_KEYWORDS.some((kw) => text.includes(kw));
  if (hasKeyword) return "standard";

  // --- Simple: very short message, no keywords, no tool history ---
  if (text.length <= 120 && toolRounds === 0) return "simple";

  return "standard";
}
