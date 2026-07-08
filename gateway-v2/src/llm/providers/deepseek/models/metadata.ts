import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getDeepSeekModelPricing } from "./pricing";
import { getReasoningForDeepSeekModel } from "./reasoning";
import {
  contextWindowForDeepSeekModel,
  isDeepSeekChatModel,
  maxOutputForDeepSeekModel,
  supportsDeepSeekJsonSchema,
  supportsDeepSeekPromptCaching,
  supportsDeepSeekTools,
  supportsDeepSeekVision
} from "./families";

// DeepSeek's /models returns IDs but no capability hints. A discovered id is mapped to a
// ModelInfo here: chat models are built with per-model sub-features from ./families and
// ./reasoning; anything that is not a deepseek-* chat model is dropped from the catalog
// (returns undefined → filtered by the discovery caller).
export function createDeepSeekModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  if (isDeepSeekChatModel(id)) return createDeepSeekChatModel(id, {}, createdAt);
  return undefined;
}

export function createDeepSeekChatModel(id: string, overrides: Partial<ChatFeatures> = {}, createdAt?: number): ModelInfo {
  const chat: ChatFeatures = {
    streaming: true,
    vision: supportsDeepSeekVision(id),
    tools: supportsDeepSeekTools(id),
    reasoning: getReasoningForDeepSeekModel(id),
    jsonSchema: supportsDeepSeekJsonSchema(id),
    promptCaching: supportsDeepSeekPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "deepseek",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getDeepSeekModelPricing(id),
    contextWindow: contextWindowForDeepSeekModel(id),
    maxTokens: maxOutputForDeepSeekModel(id),
    supportsVision: chat.vision,
    supportsTools: chat.tools,
    supportsStreaming: chat.streaming,
    supportsSystemPrompts: true,
    inputTypes: chat.vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: chat.reasoning.supported ? ["reasoning"] : undefined
  };
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `deepseek:${id}`;
}
