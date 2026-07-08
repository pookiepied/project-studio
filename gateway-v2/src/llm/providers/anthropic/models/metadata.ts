import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getAnthropicModelPricing } from "./pricing";
import { getReasoningForAnthropicModel } from "./reasoning";
import {
  contextWindowForAnthropicModel,
  isAnthropicChatModel,
  maxOutputForAnthropicModel,
  supportsAnthropicJsonSchema,
  supportsAnthropicPromptCaching,
  supportsAnthropicTools,
  supportsAnthropicVision
} from "./families";

export function createAnthropicModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  // Anthropic serves only chat/multimodal Claude models — no embeddings/audio/image.
  if (isAnthropicChatModel(id)) return createAnthropicChatModel(id, {}, createdAt);
  return undefined;
}

export function createAnthropicChatModel(
  id: string,
  overrides: Partial<ChatFeatures> = {},
  createdAt?: number
): ModelInfo {
  const chat = {
    streaming: true,
    vision: supportsAnthropicVision(id),
    tools: supportsAnthropicTools(id),
    reasoning: getReasoningForAnthropicModel(id),
    jsonSchema: supportsAnthropicJsonSchema(id),
    promptCaching: supportsAnthropicPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "anthropic",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getAnthropicModelPricing(id),
    contextWindow: contextWindowForAnthropicModel(id),
    maxTokens: maxOutputForAnthropicModel(id),
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
  return id.includes(":") ? id : `anthropic:${id}`;
}
