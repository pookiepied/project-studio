import type { ProviderModule } from "@/providers/types";
import { zaiCapabilities } from "./capabilities";
import { zaiChat } from "./chat";

// Z.AI (GLM) via Cloudflare AI Gateway CUSTOM provider (slug `custom-zai`) + the official
// @ai-sdk/openai-compatible package. Scope: text + multimodal (vision) chat only (see
// ./capabilities.ts).
export const zaiProvider: ProviderModule = {
  id: "zai",
  capabilities: zaiCapabilities,
  chat: zaiChat
};
