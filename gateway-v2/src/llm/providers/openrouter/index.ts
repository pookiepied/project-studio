import type { ProviderModule } from "../../../core/registry";
import { openrouterCapabilities } from "./capabilities";
import { openrouterChat } from "./chat";
import { openrouterCredits } from "./credits";
import { listOpenRouterModels } from "./models";

// OpenRouter (aggregator) via the official @ai-sdk/openai-compatible package + CF AI Gateway
// native `openrouter` slug (BYOK alias-ready). Scope: text + multimodal (vision) CHAT only,
// plus the credits/balance endpoint. Image/video/audio/embeddings/rerank are intentionally
// excluded (see ./capabilities.ts). No first-party @ai-sdk/openrouter package exists — the
// OpenAI-compatible path is the official, non-custom way to add it.
export const openrouterProvider: ProviderModule = {
  id: "openrouter",
  capabilities: openrouterCapabilities,
  models: listOpenRouterModels,
  chat: openrouterChat,
  credits: openrouterCredits
};
