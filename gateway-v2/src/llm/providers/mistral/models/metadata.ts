import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getMistralModelPricing } from "./pricing";
import { getReasoningForMistralModel } from "./reasoning";
import {
  contextWindowForMistralModel,
  isMistralChatModel,
  isMistralEmbeddingModel,
  maxOutputForMistralModel,
  supportsMistralJsonSchema,
  supportsMistralPromptCaching,
  supportsMistralTools,
  supportsMistralVision
} from "./families";

// Mistral's /v1/models returns IDs but no capability hints. A discovered id is mapped to a
// ModelInfo here: embedding models become embedding entries, chat models get per-model
// sub-features from ./families + ./reasoning; anything else (moderation / OCR utilities) is
// dropped from the catalog (returns undefined → filtered by the discovery caller).
export function createMistralModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  if (isMistralEmbeddingModel(id)) return createMistralEmbeddingModel(id, createdAt);
  if (isMistralChatModel(id)) return createMistralChatModel(id, {}, createdAt);
  return undefined;
}

export function createMistralChatModel(id: string, overrides: Partial<ChatFeatures> = {}, createdAt?: number): ModelInfo {
  const chat: ChatFeatures = {
    streaming: true,
    vision: supportsMistralVision(id),
    tools: supportsMistralTools(id),
    reasoning: getReasoningForMistralModel(id),
    jsonSchema: supportsMistralJsonSchema(id),
    promptCaching: supportsMistralPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "mistral",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getMistralModelPricing(),
    contextWindow: contextWindowForMistralModel(id),
    maxTokens: maxOutputForMistralModel(id),
    supportsVision: chat.vision,
    supportsTools: chat.tools,
    supportsStreaming: chat.streaming,
    supportsSystemPrompts: true,
    inputTypes: chat.vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: chat.reasoning.supported ? ["reasoning"] : undefined
  };
}

export function createMistralEmbeddingModel(id: string, createdAt?: number): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "mistral",
    providerModelId: id,
    displayName: id,
    type: "embedding",
    createdAt,
    capabilities: {
      modalities: [Capability.Embeddings]
    },
    pricing: getMistralModelPricing(),
    inputTypes: ["text"],
    outputTypes: ["embedding"]
  };
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `mistral:${id}`;
}
