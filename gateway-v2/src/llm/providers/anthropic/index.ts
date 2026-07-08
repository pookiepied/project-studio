import type { ProviderModule } from "../../../core/registry";
import { anthropicCapabilities } from "./capabilities";
import { anthropicChat } from "./chat";
import { listAnthropicModels } from "./models";

// Anthropic (Claude): chat-only. No embed/transcribe/speak/image/credits handlers —
// the provider does not support those capabilities (see ./capabilities.ts).
export const anthropicProvider: ProviderModule = {
  id: "anthropic",
  capabilities: anthropicCapabilities,
  models: listAnthropicModels,
  chat: anthropicChat
};
