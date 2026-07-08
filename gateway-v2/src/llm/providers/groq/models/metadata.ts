import { Capability, type ChatFeatures, type ModelInfo } from "../../../../core/capabilities";
import { getGroqModelPricing } from "./pricing";
import { getReasoningForGroqModel } from "./reasoning";
import {
  contextWindowForGroqModel,
  isGroqChatModel,
  isGroqGuardModel,
  isGroqSpeechModel,
  isGroqTranscriptionModel,
  maxOutputForGroqModel,
  supportsGroqJsonSchema,
  supportsGroqPromptCaching,
  supportsGroqTools,
  supportsGroqVision
} from "./families";

export function createGroqModelFromId(id: string, createdAt?: number): ModelInfo | undefined {
  // Safety/guard models (llama-guard, prompt-guard, gpt-oss-safeguard) are not user-facing
  // chat models — exclude them from the catalog entirely.
  if (isGroqGuardModel(id)) return undefined;
  if (isGroqTranscriptionModel(id)) return createGroqTranscriptionModel(id, createdAt);
  if (isGroqSpeechModel(id)) return createGroqSpeechModel(id, createdAt);
  if (isGroqChatModel(id)) return createGroqChatModel(id, {}, createdAt);
  return undefined;
}

export function createGroqChatModel(id: string, overrides: Partial<ChatFeatures> = {}, createdAt?: number): ModelInfo {
  const chat = {
    streaming: true,
    vision: supportsGroqVision(id),
    tools: supportsGroqTools(id),
    reasoning: getReasoningForGroqModel(id),
    jsonSchema: supportsGroqJsonSchema(id),
    promptCaching: supportsGroqPromptCaching(id),
    ...overrides
  };

  return {
    id: providerModelId(id),
    provider: "groq",
    providerModelId: id,
    displayName: id,
    type: chat.vision ? "multimodal" : "chat",
    createdAt,
    capabilities: {
      modalities: [Capability.Chat],
      chat
    },
    pricing: getGroqModelPricing(id),
    contextWindow: contextWindowForGroqModel(id),
    maxTokens: maxOutputForGroqModel(id),
    supportsVision: chat.vision,
    supportsTools: chat.tools,
    supportsStreaming: chat.streaming,
    supportsSystemPrompts: true,
    inputTypes: chat.vision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    specialFeatures: chat.reasoning.supported ? ["reasoning"] : undefined
  };
}

export function createGroqTranscriptionModel(id: string, createdAt?: number): ModelInfo {
  return createGroqCapabilityModel(id, {
    type: "audio",
    modalities: [Capability.Transcription],
    inputTypes: ["audio"],
    outputTypes: ["text"],
    createdAt
  });
}

export function createGroqSpeechModel(id: string, createdAt?: number): ModelInfo {
  return createGroqCapabilityModel(id, {
    type: "tts",
    modalities: [Capability.Speech],
    inputTypes: ["text"],
    outputTypes: ["audio"],
    createdAt
  });
}

function createGroqCapabilityModel(
  id: string,
  options: {
    type: NonNullable<ModelInfo["type"]>;
    modalities: Capability[];
    inputTypes: NonNullable<ModelInfo["inputTypes"]>;
    outputTypes: NonNullable<ModelInfo["outputTypes"]>;
    createdAt?: number;
  }
): ModelInfo {
  return {
    id: providerModelId(id),
    provider: "groq",
    providerModelId: id,
    displayName: id,
    type: options.type,
    createdAt: options.createdAt,
    capabilities: {
      modalities: options.modalities
    },
    pricing: getGroqModelPricing(id),
    inputTypes: options.inputTypes,
    outputTypes: options.outputTypes
  };
}

// Groq model ids can already contain a namespace slash (e.g. `openai/gpt-oss-120b`), so the
// gateway id is prefixed with `groq:` while the raw providerModelId keeps the original slug.
function providerModelId(id: string): string {
  return id.startsWith("groq:") ? id : `groq:${id}`;
}
