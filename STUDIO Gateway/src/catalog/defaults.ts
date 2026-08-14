/**
 * Shared defaults for catalog sync and migrations.
 * Single source for provider base URLs — prevents drift between runtime and DDL.
 */

import type { Protocol } from "../providers/types.ts";

export const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  anthropic: "https://api.anthropic.com",
  cerebras: "https://api.cerebras.ai/v1",
  cohere: "https://api.cohere.com/compatibility/v1",
  deepseek: "https://api.deepseek.com",
  fireworks: "https://api.fireworks.ai/inference/v1",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  huggingface: "https://router.huggingface.co/v1",
  minimax: "https://api.minimax.chat/v1",
  mistral: "https://api.mistral.ai/v1",
  moonshot: "https://api.moonshot.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  xai: "https://api.x.ai/v1",
  xiaomi: "https://api.xiaomimimo.com/v1",
  zai: "https://api.z.ai/api/paas/v4",
  // Optional extras that sync may encounter via models.dev
  nvidia: "https://integrate.api.nvidia.com/v1",
  perplexity: "https://api.perplexity.ai",
  fal: "https://api.fal.ai/v1",
  elevenlabs: "https://api.elevenlabs.io/v1",
};

export function resolveProviderUrl(devId: string, registryId: string, api: string | undefined): string {
  const hasTemplate = api?.includes("${") ?? false;
  if (api && !hasTemplate && /^https?:\/\/[^$\s]+$/.test(api)) return api;
  return DEFAULT_PROVIDER_URLS[registryId] ?? DEFAULT_PROVIDER_URLS[devId] ?? "";
}

export function inferProtocol(npm: string | undefined, api: string | undefined): Protocol {
  if (npm?.startsWith("@ai-sdk/anthropic")) return "anthropic-messages";
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") return "google-generative-ai";
  if (api?.includes("/v1/responses")) return "openai-responses";
  return "openai-completions";
}
