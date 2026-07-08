import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getMinimaxModelPricing } from "./pricing";
import { supportsMinimaxJsonSchema, supportsMinimaxTools, supportsMinimaxVision } from "./families";

// Builds a gateway ModelInfo for a MiniMax chat model. The catalog `id` is namespaced
// `minimax:<model>` to avoid colliding with other providers; `providerModelId` stays the raw
// MiniMax model id (e.g. `MiniMax-M3`), which the chat route sends to the client.
export function createMinimaxChatModel(id: string): ModelInfo {
  const vision = supportsMinimaxVision(id);
  const chat: ChatFeatures = {
    streaming: true,
    vision,
    tools: supportsMinimaxTools(id),
    reasoning: { supported: false, efforts: [], source: "family-rule", confidence: "family" },
    jsonSchema: supportsMinimaxJsonSchema(id),
    promptCaching: false
  };

  return {
    id: `minimax:${id}`,
    provider: "minimax",
    providerModelId: id,
    displayName: id,
    type: vision ? "multimodal" : "chat",
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getMinimaxModelPricing(),
    supportsVision: vision,
    supportsTools: chat.tools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"]
  };
}
