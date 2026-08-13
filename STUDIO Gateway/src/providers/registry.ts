/**
 * Provider registry - maps provider id -> adapter.
 * Imported centrally. Add new provider by adding entry here and provider folder.
 */

import type { ProviderDefinition, Protocol } from "./types.ts";
import { anthropicMessagesAdapter } from "../adapters/anthropic-messages/adapter.ts";
import { openAICompletionsAdapter } from "../adapters/openai-completions/adapter.ts";
import { openAIResponsesAdapter } from "../adapters/openai-responses/adapter.ts";
import { googleGenerativeAdapter } from "../adapters/google-generative-ai/adapter.ts";
import { sdkProviderAdapters } from "../adapters/sdk.ts";
import { providerQuirks } from "./quirks.ts";

export interface Adapter {
  readonly protocol: Protocol;
  discover(apiKey: string, baseUrl: string): Promise<import("./types.ts").ModelDefinition[]>;
  chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response>;
}

const adapters: Record<Protocol, Adapter> = {
  "anthropic-messages": anthropicMessagesAdapter,
  "openai-completions": openAICompletionsAdapter,
  "openai-responses": openAIResponsesAdapter,
  "google-generative-ai": googleGenerativeAdapter,
};

// Per-provider adapters — now single SDK+quirks file, not 20 folders.
// Legacy `src/providers/*/adapter.ts` remain for reference but are no longer imported.
const providerAdapters: Record<string, Adapter> = sdkProviderAdapters as Record<string, Adapter>;

// Keep quirks import to ensure bundle includes patch table (tree-shake proof)
void providerQuirks;

// Static provider definitions - 20 providers: 3 core + 15 text + 2 image/audio
export const providerDefinitions: ProviderDefinition[] = [
  { id: "alibaba", name: "Alibaba Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", protocol: "anthropic-messages", authMode: "apiKey", enabled: true },
  { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.com/compatibility/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "elevenlabs", name: "ElevenLabs", baseUrl: "https://api.elevenlabs.io/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "fal", name: "Fal", baseUrl: "https://api.fal.ai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "fireworks", name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "google", name: "Google", baseUrl: "https://generativelanguage.googleapis.com", protocol: "google-generative-ai", authMode: "apiKey", enabled: true },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "huggingface", name: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "moonshot", name: "Moonshot", baseUrl: "https://api.moonshot.ai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "together", name: "Together", baseUrl: "https://api.together.xyz/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "xai", name: "xAI", baseUrl: "https://api.x.ai/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "xiaomi", name: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", protocol: "openai-completions", authMode: "apiKey", enabled: true },
  { id: "zai", name: "ZAI", baseUrl: "https://api.z.ai/api/paas/v4", protocol: "openai-completions", authMode: "apiKey", enabled: true },
];

export function getAdapter(protocol: Protocol): Adapter {
  const a = adapters[protocol];
  if (!a) throw new Error(`Adapter not implemented: ${protocol}`);
  return a;
}

export function getProviderAdapter(providerId: string): Adapter {
  return providerAdapters[providerId] ?? adapters["openai-completions"];
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return providerDefinitions.find((p) => p.id === id);
}
