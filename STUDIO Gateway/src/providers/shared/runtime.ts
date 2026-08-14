/**
 * Shared AI SDK runtime helpers.
 * Normalizes OpenAI request bodies to AI SDK calls, then back to OpenAI SSE/JSON.
 * All provider folders (anthropic/google/openai/third-party) use these helpers.
 */

import type { ReasoningRequest } from "../contract.ts";

export type OpenAIChatBody = Record<string, unknown> & {
  model: string;
  messages: Array<{ role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }>;
  tool_choice?: unknown;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  reasoning_effort?: string;
};

// Map universal reasoning to AI SDK portable `reasoning: "low" | "medium" | "high" | ...`
export function resolveReasoning(req?: ReasoningRequest): { reasoning?: string } {
  if (!req || req.mode === "default") return {};
  if (req.mode === "none") return { reasoning: "none" };
  if (req.mode === "budget") {
    // Exact budget uses providerOptions; do not set portable reasoning to avoid precedence conflict
    return {};
  }
  if (req.mode === "adaptive") {
    return { reasoning: req.level ?? "medium" };
  }
  return {};
}

// Extract OpenAI tools to AI SDK tool set (for SDK path)
export function openAIToolsToAISDKTools(openAITools: OpenAIChatBody["tools"]): Record<string, unknown> | undefined {
  if (!openAITools || openAITools.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const t of openAITools) {
    if (t.type === "function" && t.function.name) {
      out[t.function.name] = {
        description: t.function.description,
        inputSchema: t.function.parameters ?? { type: "object", properties: {} },
      };
    }
  }
  return out;
}

// Vision: OpenAI content blocks -> AI SDK file parts
export function normalizeMessagesForSDK(messages: OpenAIChatBody["messages"]): unknown[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    if (Array.isArray(m.content)) {
      const content = (m.content as Array<Record<string, unknown>>).map((block) => {
        if (block.type === "image_url" && (block as { image_url?: { url?: string } }).image_url?.url) {
          const url = (block as { image_url: { url: string } }).image_url.url;
          // Keep as image part — AI SDK handles http URLs, data URLs, and provider file refs
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(.+);base64,(.+)$/);
            if (match) return { type: "file", data: match[2], mediaType: match[1] };
          }
          return { type: "image", image: url };
        }
        if (block.type === "text") return { type: "text", text: block.text };
        return block;
      });
      return { ...m, content };
    }
    return m;
  });
}

// Budget reasoning is handled via parseReasoning → ReasoningRequest (budget mode)
// Former `extractBudgetTokens` was dead (always returned undefined for legacy path) and is removed.
// Use `parseReasoning(body)` → `{mode:"budget", budgetTokens}` for explicit budgets.

export const BUDGET_SUPPORTED_PROVIDERS = new Set(["anthropic", "google"]);

// Build providerOptions for exact budget control — only anthropic/google support exact budgets
// For other providers, budget is unsupported and caller should return 501
export function buildProviderOptionsForReasoning(
  providerId: string,
  reasoning: ReasoningRequest | undefined,
  _body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (reasoning?.mode === "budget") {
    if (providerId === "anthropic") return { anthropic: { thinking: { type: "enabled", budgetTokens: reasoning.budgetTokens } } };
    if (providerId === "google") return { google: { thinkingConfig: { thinkingBudget: reasoning.budgetTokens } } };
    // Explicit unsupported — do not silently ignore
    return undefined;
  }
  return undefined;
}

export function isBudgetSupported(providerId: string): boolean {
  return BUDGET_SUPPORTED_PROVIDERS.has(providerId);
}

// Re-export SSE helpers — canonical in ./sse.ts
export { openAIChunk, openAIDone, stableStreamId, stableCompletionId, aiSdkStreamToResponse, buildChatCompletionResponse, toOpenAIChatCompletion } from "./sse.ts";
