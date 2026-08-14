/**
 * Anthropic provider — single home for SDK, quirks, capabilities, catalog.
 */
import type { ProviderRuntime } from "../contract.ts";
import { anthropicChat } from "./sdk.ts";
import { anthropicCapabilities } from "./capabilities.ts";
import { ANTHROPIC_STATIC_MODELS } from "./discovery.ts";

export const anthropicProvider: ProviderRuntime = {
  providerId: "anthropic",
  protocol: "anthropic-messages",
  async chat(req) {
    // Anthropic supports adaptive and budget reasoning via AI SDK.
    // Quirks are not needed for Anthropic protocol; SDK handles translation.
    return anthropicChat(req);
  },
  async discover(apiKey, baseUrl) {
    if (!apiKey || !baseUrl) return ANTHROPIC_STATIC_MODELS;
    try {
      const { getProtocolAdapter } = await import("../../adapters/router.ts");
      const adapter = getProtocolAdapter("anthropic-messages");
      const models = await adapter.discover(apiKey, baseUrl);
      return models;
    } catch {
      return ANTHROPIC_STATIC_MODELS;
    }
  },
};

export { anthropicCapabilities };
