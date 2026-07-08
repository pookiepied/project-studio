import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getOpenAIModelPricing } from "./pricing";
import { getReasoningForOpenAIModel } from "./reasoning";
import {
  contextWindowForOpenAIModel,
  isOpenAIChatModel,
  isOpenAIEmbeddingModel,
  isOpenAIImageModel,
  isOpenAISpeechModel,
  isOpenAITranscriptionModel,
  maxOutputForOpenAIModel,
  supportsOpenAIImageEdit,
  supportsOpenAIJsonSchema,
  supportsOpenAIPromptCaching,
  supportsOpenAITools,
  supportsOpenAIVision
} from "./families";

export function createOpenAIModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  if (isOpenAIChatModel(id)) return createOpenAIChatModel(id, {}, createdAt);
  if (isOpenAIEmbeddingModel(id)) return createOpenAIEmbeddingModel(id);
  if (isOpenAITranscriptionModel(id)) return createOpenAITranscriptionModel(id);
  if (isOpenAISpeechModel(id)) return createOpenAISpeechModel(id);
  if (isOpenAIImageModel(id)) return createOpenAIImageModel(id, supportsOpenAIImageEdit(id));
  return undefined;
}

export function createOpenAIChatModel(id: string, overrides: Partial<ChatFeatures> = {}, createdAt?: number): ModelInfo {
  const chat = {
    streaming: true,
    vision: supportsOpenAIVision(id),
    tools: supportsOpenAITools(id),
    reasoning: getReasoningForOpenAIModel(id),
    jsonSchema: supportsOpenAIJsonSchema(id),
    promptCaching: supportsOpenAIPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "openai",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getOpenAIModelPricing(id),
    contextWindow: contextWindowForOpenAIModel(id),
    maxTokens: maxOutputForOpenAIModel(id),
    supportsVision: chat.vision,
    supportsTools: chat.tools,
    supportsStreaming: chat.streaming,
    supportsSystemPrompts: true,
    inputTypes: chat.vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: chat.reasoning.supported ? ["reasoning"] : undefined
  };
}

export function createOpenAIEmbeddingModel(id: string): ModelInfo {
  return createOpenAICapabilityModel(id, {
    type: "embedding",
    modalities: [Capability.Embeddings],
    inputTypes: ["text"],
    outputTypes: ["embedding"]
  });
}

export function createOpenAITranscriptionModel(id: string): ModelInfo {
  return createOpenAICapabilityModel(id, {
    type: "audio",
    modalities: [Capability.Transcription],
    inputTypes: ["audio"],
    outputTypes: ["text"]
  });
}

export function createOpenAISpeechModel(id: string): ModelInfo {
  return createOpenAICapabilityModel(id, {
    type: "tts",
    modalities: [Capability.Speech],
    inputTypes: ["text"],
    outputTypes: ["audio"]
  });
}

export function createOpenAIImageModel(id: string, supportsEdit: boolean): ModelInfo {
  return createOpenAICapabilityModel(id, {
    type: "image",
    modalities: supportsEdit ? [Capability.ImageGenerate, Capability.ImageEdit] : [Capability.ImageGenerate],
    inputTypes: supportsEdit ? ["text", "image"] : ["text"],
    outputTypes: ["image"]
  });
}

function createOpenAICapabilityModel(
  id: string,
  options: {
    type: NonNullable<ModelInfo["type"]>;
    modalities: Capability[];
    inputTypes: NonNullable<ModelInfo["inputTypes"]>;
    outputTypes: NonNullable<ModelInfo["outputTypes"]>;
  }
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "openai",
    providerModelId: id,
    displayName: id,
    type: options.type,
    capabilities: {
      modalities: options.modalities
    },
    pricing: getOpenAIModelPricing(id),
    inputTypes: options.inputTypes,
    outputTypes: options.outputTypes
  };
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `openai:${id}`;
}

