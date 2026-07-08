import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getXiaomiModelPricing } from "./pricing";
import { supportsXiaomiJsonSchema, supportsXiaomiTools, supportsXiaomiVision } from "./families";

// Builds a gateway ModelInfo for a Xiaomi MiMo chat model. The catalog `id` is namespaced
// `xiaomi:<model>` to avoid colliding with other providers; `providerModelId` stays the raw
// MiMo model id (e.g. `mimo-v2.5-pro`), which the chat route sends to the client.
export function createXiaomiChatModel(id: string): ModelInfo {
  const vision = supportsXiaomiVision(id);
  const chat: ChatFeatures = {
    streaming: true,
    vision,
    tools: supportsXiaomiTools(id),
    reasoning: { supported: false, efforts: [], source: "family-rule", confidence: "family" },
    jsonSchema: supportsXiaomiJsonSchema(id),
    promptCaching: false
  };

  return {
    id: `xiaomi:${id}`,
    provider: "xiaomi",
    providerModelId: id,
    displayName: id,
    type: vision ? "multimodal" : "chat",
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getXiaomiModelPricing(),
    supportsVision: vision,
    supportsTools: chat.tools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"]
  };
}
