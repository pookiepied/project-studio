/**
 * Provider registry — unified entry for every provider.
 * Each provider lives in one folder (sdk + quirks + capabilities + catalog).
 * Third-party providers share a common OpenAI-compatible runtime but keep
 * individual folders for discoverability (src/providers/third-party/<id>/).
 */

import type { Protocol } from "./types.ts";
import type { ProviderRuntime } from "./contract.ts";
import { getProtocolAdapter, getProviderAdapter as getLegacyAdapter } from "../adapters/router.ts";
import { logger } from "../observability/logger.ts";
import { providerError } from "../lib/errors.ts";

export interface Adapter {
  readonly protocol: Protocol;
  discover(apiKey: string, baseUrl: string): Promise<import("./types.ts").ModelDefinition[]>;
  chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response>;
}

// Legacy protocol adapters — kept for direct protocol access and discovery fallbacks
export function getAdapter(protocol: Protocol): Adapter {
  return getProtocolAdapter(protocol);
}

export function getProviderAdapter(providerId: string, protocol: Protocol): Adapter {
  return getLegacyAdapter(providerId, protocol);
}

// Unified runtime — AI SDK primary, custom fallback, quirks applied inside provider
import { anthropicProvider } from "./anthropic/index.ts";
import { googleProvider } from "./google/index.ts";
import { openAIProvider } from "./openai/index.ts";
import { falProvider } from "./third-party/fal/index.ts";
import { elevenLabsProvider } from "./third-party/elevenlabs/index.ts";

const firstParty: Record<string, ProviderRuntime> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  openai: openAIProvider,
  fal: falProvider,
  elevenlabs: elevenLabsProvider,
};

// Static map for third-party providers — bundler-analyzable, no template literal
// Each entry re-exports the generic OpenAI-compatible runtime with a discoverable home folder
const thirdPartyLoaders: Record<string, () => Promise<ProviderRuntime>> = {
  alibaba: () => import("./third-party/alibaba/index.ts").then((m) => m.alibabaProvider),
  cerebras: () => import("./third-party/cerebras/index.ts").then((m) => m.cerebrasProvider),
  cohere: () => import("./third-party/cohere/index.ts").then((m) => m.cohereProvider),
  deepseek: () => import("./third-party/deepseek/index.ts").then((m) => m.deepseekProvider),
  fireworks: () => import("./third-party/fireworks/index.ts").then((m) => m.fireworksProvider),
  groq: () => import("./third-party/groq/index.ts").then((m) => m.groqProvider),
  huggingface: () => import("./third-party/huggingface/index.ts").then((m) => m.huggingfaceProvider),
  minimax: () => import("./third-party/minimax/index.ts").then((m) => m.minimaxProvider),
  mistral: () => import("./third-party/mistral/index.ts").then((m) => m.mistralProvider),
  moonshot: () => import("./third-party/moonshot/index.ts").then((m) => m.moonshotProvider),
  nvidia: () => import("./third-party/nvidia/index.ts").then((m) => m.nvidiaProvider),
  openrouter: () => import("./third-party/openrouter/index.ts").then((m) => m.openrouterProvider),
  perplexity: () => import("./third-party/perplexity/index.ts").then((m) => m.perplexityProvider),
  together: () => import("./third-party/together/index.ts").then((m) => m.togetherProvider),
  xai: () => import("./third-party/xai/index.ts").then((m) => m.xaiProvider),
  xiaomi: () => import("./third-party/xiaomi/index.ts").then((m) => m.xiaomiProvider),
  zai: () => import("./third-party/zai/index.ts").then((m) => m.zaiProvider),
};

export const CURATED_THIRD_PARTY_IDS = new Set(Object.keys(thirdPartyLoaders));

export async function getProviderRuntime(providerId: string, protocol: Protocol): Promise<ProviderRuntime> {
  if (firstParty[providerId]) return firstParty[providerId];

  // Curated third-party — static map keeps bundle analyzable
  const loader = thirdPartyLoaders[providerId];
  if (loader) {
    try {
      return await loader();
    } catch (e) {
      logger.error("Curated provider loader failed", { provider: providerId, error: e instanceof Error ? e.message : String(e) });
      // Never silently downgrade curated provider to generic openai-compatible
      throw providerError(providerId, `Failed to load curated provider ${providerId}`, 500, e);
    }
  }

  // Only unknown catalog providers use generic fallback — preserves explicit 501 for curated failures
  const isCurated = providerId in firstParty || CURATED_THIRD_PARTY_IDS.has(providerId);
  if (isCurated) {
    // Should have returned above; if we reach here, loader was missing (should not happen)
    throw providerError(providerId, `Curated provider ${providerId} has no loader`, 500);
  }

  // Generic fallback for any catalog provider not explicitly curated — still uses AI SDK openai-compatible
  const { thirdPartyChat, thirdPartyEmbed, thirdPartyImage } = await import("./third-party/common.ts");
  const generic: ProviderRuntime = {
    providerId,
    protocol: protocol === "openai-completions" ? "openai-completions" : protocol,
    async chat(req) { return thirdPartyChat(providerId, req); },
    async discover(apiKey, baseUrl) {
      const { openAICompletionsAdapter } = await import("../adapters/openai-completions/adapter.ts");
      return openAICompletionsAdapter.discover(apiKey, baseUrl);
    },
    async generateImage(req) { return thirdPartyImage(providerId, req); },
    async embed(req) { return thirdPartyEmbed(providerId, req); },
  };
  return generic;
}

export function isFirstParty(providerId: string): boolean {
  return providerId in firstParty;
}
