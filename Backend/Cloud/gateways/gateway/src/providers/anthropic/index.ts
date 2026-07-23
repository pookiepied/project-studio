import type { ProviderModule } from "@/providers/types";
import { anthropicCapabilities } from "./capabilities";
import { anthropicChat } from "./chat";

// Anthropic (Claude): chat-only. No embed/transcribe/speak/image/credits handlers -
// the provider does not support those capabilities (see ./capabilities.ts).
export const anthropicProvider: ProviderModule = {
  id: "anthropic",
  capabilities: anthropicCapabilities,
  chat: anthropicChat
};
