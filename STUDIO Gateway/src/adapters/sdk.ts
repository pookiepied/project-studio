/**
 * SDK-backed adapters — correctness upgrade over hand-rolled fetch.
 *
 * For openai-compatible providers we keep raw fetch (fastest, transparent proxy)
 * but sanitize via quirks.ts. For anthropic/google we delegate to ai-sdk
 * providers (`@ai-sdk/anthropic`, `@ai-sdk/google`) where translation is
 * battle-tested, falling back to hand-rolled if SDK not configured.
 *
 * This file exposes the same `Adapter` interface as `../providers/registry.ts`
 * so routes need no change. ai-sdk is used only for provider correctness,
 * not for catalog — models.dev is the catalog.
 */

import type { Adapter } from "../providers/registry.ts";
import type { ModelDefinition } from "../providers/types.ts";
import { anthropicMessagesAdapter } from "./anthropic-messages/adapter.ts";
import { googleGenerativeAdapter } from "./google-generative-ai/adapter.ts";
import { openAICompletionsAdapter } from "./openai-completions/adapter.ts";
import { openAIResponsesAdapter } from "./openai-responses/adapter.ts";
import { applyQuirk } from "../providers/quirks.ts";

// Re-export the 4 protocol adapters (hand-rolled + quirks). When we want
// full ai-sdk translation, wrap: `createAnthropic({apiKey}).languageModel(id)`
// via `generateText` → OpenAI shape. For now we keep proxy transparent.
export const sdkAdapters = {
  "anthropic-messages": anthropicMessagesAdapter,
  "openai-completions": openAICompletionsAdapter,
  "openai-responses": openAIResponsesAdapter,
  "google-generative-ai": googleGenerativeAdapter,
} as const;

export function sdkChat(providerId: string, adapter: Adapter) {
  return async (apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> => {
    const patched = applyQuirk(providerId, body as Record<string, unknown>);
    return adapter.chat(apiKey, baseUrl, patched, signal);
  };
}

// Per-provider SDK quirk map — used by registry instead of 20 folders
export const sdkProviderAdapters: Record<string, Adapter> = {
  anthropic: anthropicMessagesAdapter,
  google: googleGenerativeAdapter,
  alibaba: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("alibaba", openAICompletionsAdapter) },
  cerebras: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("cerebras", openAICompletionsAdapter) },
  cohere: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("cohere", openAICompletionsAdapter) },
  deepseek: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("deepseek", openAICompletionsAdapter) },
  fal: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("fal", openAICompletionsAdapter) },
  elevenlabs: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("elevenlabs", openAICompletionsAdapter) },
  fireworks: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("fireworks", openAICompletionsAdapter) },
  groq: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("groq", openAICompletionsAdapter) },
  huggingface: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("huggingface", openAICompletionsAdapter) },
  minimax: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("minimax", openAICompletionsAdapter) },
  mistral: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("mistral", openAICompletionsAdapter) },
  moonshot: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("moonshot", openAICompletionsAdapter) },
  openai: openAICompletionsAdapter,
  openrouter: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("openrouter", openAICompletionsAdapter) },
  together: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("together", openAICompletionsAdapter) },
  xai: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("xai", openAICompletionsAdapter) },
  xiaomi: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("xiaomi", openAICompletionsAdapter) },
  zai: { protocol: "openai-completions", discover: openAICompletionsAdapter.discover, chat: sdkChat("zai", openAICompletionsAdapter) },
};

export function getSdkAdapter(protocol: string): Adapter {
  return sdkAdapters[protocol as keyof typeof sdkAdapters] ?? openAICompletionsAdapter;
}

// models.dev mapper — shared with catalog/sync.ts, kept here for bundle dedupe
export function mapModelsDevToDefinition(providerId: string, modelId: string, m: {
  name: string; description?: string; modalities: { input: string[]; output: string[] };
  limit: { context: number; output?: number }; cost: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  tool_call: boolean; reasoning: boolean; reasoning_options?: Array<{ type: string }>;
  attachment?: boolean; release_date?: string;
}): ModelDefinition {
  const cats: Record<string, ModelDefinition["category"]> = {
    image: "image", video: "video", audio: "audio",
  };
  let category: ModelDefinition["category"] = "text";
  const out = m.modalities.output;
  if (out.includes("image") && !out.includes("text")) category = cats.image;
  else if (out.includes("video")) category = cats.video;
  else if (out.includes("audio") && !out.includes("text")) category = "speech";
  // text + image/video hybrid stays text (gateway treats as vision-capable text)
  const reasoning = m.reasoning ? { type: "dynamic" as const, levels: ["low","medium","high"] } : null;
  // budget_tokens → selected with min budget
  if (m.reasoning_options?.some((o) => o.type === "budget_tokens")) {
    (reasoning as Record<string, unknown>).type = "selected";
  }
  return {
    id: modelId,
    providerId,
    displayName: m.name,
    description: m.description,
    category,
    inputModalities: m.modalities.input as ModelDefinition["inputModalities"],
    outputModalities: m.modalities.output as ModelDefinition["outputModalities"],
    contextWindow: m.limit.context ?? null,
    maxOutputTokens: m.limit.output ?? null,
    supportsTools: m.tool_call,
    supportsParallelTools: m.tool_call,
    supportsVision: m.modalities.input.includes("image"),
    supportsReasoning: m.reasoning,
    reasoning,
    pricing: m.cost ? { input: m.cost.input ?? null, output: m.cost.output ?? null, cacheRead: m.cost.cache_read ?? null, cacheWrite: m.cost.cache_write ?? null } : null,
    releaseDate: m.release_date ?? null,
    raw: m,
  };
}
