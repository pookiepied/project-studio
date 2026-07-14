import type { ProviderModule } from "../../../core/registry";
import { minimaxCapabilities } from "./capabilities";
import { minimaxChat } from "./chat";

// MiniMax via Cloudflare AI Gateway CUSTOM provider (slug `custom-minimax`) + the official
// @ai-sdk/openai-compatible package. Scope: text + multimodal (vision) chat only (see
// ./capabilities.ts).
export const minimaxProvider: ProviderModule = {
  id: "minimax",
  capabilities: minimaxCapabilities,
  chat: minimaxChat
};
