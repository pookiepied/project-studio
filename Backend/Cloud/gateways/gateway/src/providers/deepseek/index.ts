import type { ProviderModule } from "@/providers/types";
import { deepseekCapabilities } from "./capabilities";
import { deepseekChat } from "./chat";

// DeepSeek (OpenAI-wire-compatible): chat (text + tools + reasoning per model + streaming)
// only. The current V4 lineup supports thinking mode + reasoning_effort; it is text-only
// (no vision).
//
// No embed / transcribe / speak / image / video / audioGen / credits handlers - DeepSeek
// does not expose those as normalized gateway capabilities for this provider
// (see ./capabilities.ts).
export const deepseekProvider: ProviderModule = {
  id: "deepseek",
  capabilities: deepseekCapabilities,
  chat: deepseekChat
};
