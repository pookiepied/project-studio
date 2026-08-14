/**
 * Factory for OpenAI-compatible third-party providers.
 * Single source for 17 generic providers; each `index.ts` becomes a 2-line re-export.
 */

import type { ProviderRuntime } from "../contract.ts";
import { thirdPartyChat, thirdPartyEmbed, thirdPartyImage } from "./common.ts";
import { capabilitiesForOpenAICompatible } from "../capabilities.ts";
import type { ProviderCapabilities } from "../capabilities.ts";

export function makeThirdPartyProvider(providerId: string): ProviderRuntime {
  return {
    providerId,
    protocol: "openai-completions",
    async chat(req) { return thirdPartyChat(providerId, req); },
    async discover(apiKey, baseUrl) {
      const { openAICompletionsAdapter } = await import("../../adapters/openai-completions/adapter.ts");
      return openAICompletionsAdapter.discover(apiKey, baseUrl);
    },
    async generateImage(req) { return thirdPartyImage(providerId, req); },
    async embed(req) { return thirdPartyEmbed(providerId, req); },
  };
}

export function makeThirdPartyCapabilities(providerId: string): ProviderCapabilities {
  return capabilitiesForOpenAICompatible(providerId);
}
