import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getXaiModelPricing } from "./pricing";
import { getReasoningForXaiModel } from "./reasoning";
import {
  contextWindowForXaiModel,
  isXaiChatModel,
  maxOutputForXaiModel,
  supportsXaiJsonSchema,
  supportsXaiPromptCaching,
  supportsXaiTools,
  supportsXaiVision
} from "./families";

// xAI's /v1/models returns IDs but no capability hints. A discovered id is mapped to a
// ModelInfo here: chat models are built with per-model sub-features from ./families and
// ./reasoning; anything that is not a Grok chat model (Imagine/Voice/Build models) is
// dropped from the catalog (returns undefined → filtered by the discovery caller).
export function createXaiModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  if (isXaiChatModel(id)) return createXaiChatModel(id, {}, createdAt);
  return undefined;
}

export function createXaiChatModel(id: string, overrides: Partial<ChatFeatures> = {}, createdAt?: number): ModelInfo {
  const chat: ChatFeatures = {
    streaming: true,
    vision: supportsXaiVision(id),
    tools: supportsXaiTools(id),
    reasoning: getReasoningForXaiModel(id),
    jsonSchema: supportsXaiJsonSchema(id),
    promptCaching: supportsXaiPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "xai",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getXaiModelPricing(id),
    contextWindow: contextWindowForXaiModel(id),
    maxTokens: maxOutputForXaiModel(id),
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
  return id.includes(":") ? id : `xai:${id}`;
}
