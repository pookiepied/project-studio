import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getZaiModelPricing } from "./pricing";
import { supportsZaiJsonSchema, supportsZaiReasoning, supportsZaiTools, supportsZaiVision } from "./families";

// Builds a gateway ModelInfo for a Z.AI (GLM) chat model. The catalog `id` is namespaced
// `zai:<model>` to avoid colliding with other providers; `providerModelId` stays the raw
// Z.AI model id (e.g. `glm-5.2`), which the chat route sends to the client.
export function createZaiChatModel(id: string): ModelInfo {
  const vision = supportsZaiVision(id);
  const reasoning = supportsZaiReasoning(id);
  const chat: ChatFeatures = {
    streaming: true,
    vision,
    tools: supportsZaiTools(id),
    reasoning: reasoning
      ? {
          supported: true,
          efforts: ["low", "medium", "high"],
          defaultEffort: "medium",
          source: "family-rule",
          confidence: "family"
        }
      : { supported: false, efforts: [], source: "family-rule", confidence: "family" },
    jsonSchema: supportsZaiJsonSchema(id),
    promptCaching: false
  };

  return {
    id: `zai:${id}`,
    provider: "zai",
    providerModelId: id,
    displayName: id,
    type: vision ? "multimodal" : "chat",
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getZaiModelPricing(),
    supportsVision: vision,
    supportsTools: chat.tools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"]
  };
}
