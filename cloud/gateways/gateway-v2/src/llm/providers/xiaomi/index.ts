import type { ProviderModule } from "../../../core/registry";
import { xiaomiCapabilities } from "./capabilities";
import { xiaomiChat } from "./chat";

// Xiaomi MiMo via Cloudflare AI Gateway CUSTOM provider (slug `custom-xiaomi`) + the official
// @ai-sdk/openai-compatible package. Scope: text + multimodal (vision) chat only (see
// ./capabilities.ts).
export const xiaomiProvider: ProviderModule = {
  id: "xiaomi",
  capabilities: xiaomiCapabilities,
  chat: xiaomiChat
};
