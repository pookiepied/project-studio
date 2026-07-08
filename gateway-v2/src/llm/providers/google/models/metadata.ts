import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getGoogleModelPricing } from "./pricing";
import { getGoogleReasoningForModel } from "./reasoning";
import {
  contextWindowForGoogleModel,
  isGoogleChatModel,
  isGoogleEmbeddingModel,
  isGoogleImageModel,
  isIgnoredGoogleModel,
  maxOutputForGoogleModel,
  supportsGoogleImageEdit,
  supportsGoogleTools,
  supportsGoogleVision
} from "./families";

export interface GoogleDiscoveredModel {
  name: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export function createGoogleModelFromDiscovery(model: GoogleDiscoveredModel): ModelInfo | undefined {
  const id = model.name.replace(/^models\//, "");
  const methods = model.supportedGenerationMethods ?? [];
  if (isIgnoredGoogleModel(id)) return undefined;
  if (isGoogleEmbeddingModel(id, methods)) return createGoogleEmbeddingModel(id, model);
  if (isGoogleImageModel(id, methods)) return createGoogleImageModel(id, supportsGoogleImageEdit(id), model);
  if (isGoogleChatModel(id, methods)) return createGoogleChatModel(id, {}, model);
  return undefined;
}

export function createGoogleChatModel(
  id: string,
  overrides: Partial<ChatFeatures> = {},
  discovered?: Partial<GoogleDiscoveredModel>
): ModelInfo {
  const chat = {
    streaming: true,
    vision: supportsGoogleVision(id),
    tools: supportsGoogleTools(id),
    reasoning: getGoogleReasoningForModel(id),
    jsonSchema: true,
    promptCaching: false,
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "google",
    providerModelId: id,
    displayName: discovered?.displayName ?? id,
    type: chat.vision ? "multimodal" : "chat",
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getGoogleModelPricing(),
    contextWindow: contextWindowForGoogleModel(discovered?.inputTokenLimit, id),
    maxTokens: maxOutputForGoogleModel(discovered?.outputTokenLimit),
    supportsVision: chat.vision,
    supportsTools: chat.tools,
    supportsStreaming: chat.streaming,
    supportsSystemPrompts: true,
    inputTypes: chat.vision ? ["text", "image", "audio", "video"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: chat.reasoning.supported ? ["reasoning"] : undefined
  };
}

export function createGoogleEmbeddingModel(id: string, discovered?: Partial<GoogleDiscoveredModel>): ModelInfo {
  return createCapabilityModel(id, "embedding", [Capability.Embeddings], ["text"], ["embedding"], discovered);
}

export function createGoogleImageModel(
  id: string,
  supportsEdit: boolean,
  discovered?: Partial<GoogleDiscoveredModel>
): ModelInfo {
  return createCapabilityModel(
    id,
    "image",
    supportsEdit ? [Capability.ImageGenerate, Capability.ImageEdit] : [Capability.ImageGenerate],
    supportsEdit ? ["text", "image"] : ["text"],
    ["image"],
    discovered
  );
}

function createCapabilityModel(
  id: string,
  type: NonNullable<ModelInfo["type"]>,
  modalities: Capability[],
  inputTypes: NonNullable<ModelInfo["inputTypes"]>,
  outputTypes: NonNullable<ModelInfo["outputTypes"]>,
  discovered?: Partial<GoogleDiscoveredModel>
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "google",
    providerModelId: id,
    displayName: discovered?.displayName ?? id,
    type,
    capabilities: {
      modalities
    },
    pricing: getGoogleModelPricing(),
    contextWindow: discovered?.inputTokenLimit,
    maxTokens: discovered?.outputTokenLimit,
    inputTypes,
    outputTypes
  };
}

function providerModelId(id: string): string {
  return id.includes(":") ? id : `google:${id}`;
}
