import type { ProviderModule } from "../../../core/registry";
import { mistralCapabilities } from "./capabilities";
import { mistralChat } from "./chat";

// Mistral (OpenAI-wire-compatible): chat (text + vision on Pixtral/recent medium+small +
// tools + reasoning on Magistral + JSON schema + streaming) and embeddings (mistral-embed).
//
// No transcribe / speak / image / video / audioGen / credits handlers — the official
// @ai-sdk/mistral package exposes only chat + embeddings (see ./capabilities.ts).
export const mistralProvider: ProviderModule = {
  id: "mistral",
  capabilities: mistralCapabilities,
  chat: mistralChat
};
