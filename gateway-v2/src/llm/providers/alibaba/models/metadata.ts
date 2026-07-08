import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getAlibabaModelPricing } from "./pricing";
import { supportsAlibabaJsonSchema, supportsAlibabaTools, supportsAlibabaVision } from "./families";

// Builds a gateway ModelInfo for a Qwen chat model. The catalog `id` is namespaced
// `alibaba:<model>` to avoid colliding with other providers; `providerModelId` stays the raw
// DashScope model id (e.g. `qwen-max`), which the chat route sends to the client.
export function createAlibabaChatModel(id: string): ModelInfo {
  const vision = supportsAlibabaVision(id);
  const chat: ChatFeatures = {
    streaming: true,
    vision,
    tools: supportsAlibabaTools(id),
    reasoning: { supported: false, efforts: [], source: "family-rule", confidence: "family" },
    jsonSchema: supportsAlibabaJsonSchema(id),
    promptCaching: false
  };

  return {
    id: `alibaba:${id}`,
    provider: "alibaba",
    providerModelId: id,
    displayName: id,
    type: vision ? "multimodal" : "chat",
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getAlibabaModelPricing(),
    supportsVision: vision,
    supportsTools: chat.tools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"]
  };
}
