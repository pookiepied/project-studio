import { Capability, type ChatFeatures, type ModelInfo, type ReasoningFeatures } from "../../../../core/capabilities";
import type { OpenRouterApiModel } from "./discovery";
import { getOpenRouterPricing } from "./pricing";
import {
  isOpenRouterChatModel,
  supportsOpenRouterJsonSchema,
  supportsOpenRouterReasoning,
  supportsOpenRouterTools,
  supportsOpenRouterVision
} from "./families";

// Maps a live OpenRouter /models entry to a gateway ModelInfo. Out-of-scope models (image /
// audio / video / embedding output) return undefined and are dropped by the discovery caller.
//
// The catalog `id` is namespaced `openrouter:<slug>` to avoid colliding with first-party
// providers (OpenRouter's "openai/gpt-4o" vs our native "gpt-4o"). `providerModelId` stays the
// raw OpenRouter slug, which is what the chat route sends to the OpenAI-compatible client.
export function createOpenRouterModelFromApi(model: OpenRouterApiModel): ModelInfo | undefined {
  if (!isOpenRouterChatModel(model)) return undefined;

  const vision = supportsOpenRouterVision(model);
  const reasoning = reasoningFeatures(supportsOpenRouterReasoning(model));
  const chat: ChatFeatures = {
    streaming: true,
    vision,
    tools: supportsOpenRouterTools(model),
    reasoning,
    jsonSchema: supportsOpenRouterJsonSchema(model),
    promptCaching: false
  };

  return {
    id: `openrouter:${model.id}`,
    provider: "openrouter",
    providerModelId: model.id,
    displayName: model.name ?? model.id,
    type: vision ? "multimodal" : "chat",
    createdAt: model.created,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getOpenRouterPricing(model.pricing),
    contextWindow: model.context_length,
    maxTokens: model.max_completion_tokens,
    supportsVision: vision,
    supportsTools: chat.tools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: reasoning.supported ? ["reasoning"] : undefined
  };
}

function reasoningFeatures(supported: boolean): ReasoningFeatures {
  if (!supported) {
    return { supported: false, efforts: [], source: "live", confidence: "family" };
  }
  // OpenRouter's reasoning_effort accepts low/medium/high (see ../chat.ts mapEffort).
  return {
    supported: true,
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    source: "live",
    confidence: "family"
  };
}
