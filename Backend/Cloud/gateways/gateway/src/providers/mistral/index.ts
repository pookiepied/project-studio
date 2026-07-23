import type { ProviderModule } from "@/providers/types";
import { mistralCapabilities } from "./capabilities";
import { mistralChat } from "./chat";

// Mistral (OpenAI-wire-compatible): chat (text + vision on supported models, tools,
// JSON schema, and streaming).
//
// No transcribe / speak / image / video / audioGen / credits handlers - the official
// @ai-sdk/mistral package exposes only chat + embeddings (see ./capabilities.ts).
export const mistralProvider: ProviderModule = {
  id: "mistral",
  capabilities: mistralCapabilities,
  chat: mistralChat
};
