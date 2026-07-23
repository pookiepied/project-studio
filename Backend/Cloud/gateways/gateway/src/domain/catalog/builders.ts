import type { ProviderId } from "@/domain/contracts";
import {
  Capability,
  type ChatFeatures,
  type ModelInfo,
  type ModelPricing,
  type ReasoningFeatures
} from "@/domain/models/capabilities";
import type {
  RegistryCategory,
  RegistryModel,
  RegistryPricing,
  RegistryReasoning,
  RegistryStatus,
  VerificationLevel
} from "./schema";
import { CHECKED_AT, SOURCES } from "./metadata";
import { legacyPricing, pricingFor } from "./pricing";

export interface ChatOptions {
  contextWindow: number;
  maxTokens: number;
  vision: boolean;
  tools?: boolean;
  jsonSchema?: boolean;
  promptCaching?: boolean;
  reasoning: ReasoningFeatures["efforts"];
  reasoningSource?: ReasoningFeatures["source"];
  reasoningConfidence?: ReasoningFeatures["confidence"];
  reasoningControl?: string;
  status?: RegistryStatus;
  inputTypes?: NonNullable<ModelInfo["inputTypes"]>;
  pricing?: RegistryPricing;
}

export function chat(
  provider: ProviderId,
  nativeId: string,
  displayName: string,
  developer: string,
  family: string,
  options: ChatOptions
): RegistryModel {
  const reasoning = reasoningFeatures(options.reasoning, options.reasoningSource, options.reasoningConfidence);
  const chatFeatures: ChatFeatures = {
    streaming: true,
    vision: options.vision,
    tools: options.tools ?? true,
    reasoning,
    jsonSchema: options.jsonSchema ?? true,
    promptCaching: options.promptCaching ?? false
  };

  return withRegistry(
    {
      id: `${provider}:${nativeId}`,
      provider,
      providerModelId: nativeId,
      displayName,
      type: options.vision ? "multimodal" : "chat",
      capabilities: { modalities: [Capability.Chat], chat: chatFeatures },
      pricing: legacyPricing(options.pricing ?? pricingFor(provider, "text.chat", `${provider}:${nativeId}`)),
      contextWindow: options.contextWindow,
      maxTokens: options.maxTokens,
      supportsVision: options.vision,
      supportsTools: chatFeatures.tools,
      supportsStreaming: true,
      supportsSystemPrompts: true,
      inputTypes: options.inputTypes ?? (options.vision ? ["text", "image"] : ["text"]),
      outputTypes: ["text"],
      specialFeatures: reasoning.supported ? ["reasoning"] : undefined
    },
    {
      category: "text.chat",
      provider,
      developer,
      family,
      status: options.status ?? "active",
      reasoningControl: options.reasoningControl,
      pricing: options.pricing ?? pricingFor(provider, "text.chat", `${provider}:${nativeId}`)
    }
  );
}

export function capability(
  provider: ProviderId,
  nativeId: string,
  displayName: string,
  developer: string,
  family: string,
  category: RegistryCategory,
  modalities: Capability[],
  pricing?: RegistryPricing
): RegistryModel {
  const inputTypes: NonNullable<ModelInfo["inputTypes"]> = modalities.includes(Capability.Transcription)
    ? ["audio"]
    : modalities.includes(Capability.Speech)
      ? ["text"]
      : modalities.includes(Capability.ImageEdit)
        ? ["text", "image"]
        : modalities.includes(Capability.VideoGenerate)
          ? ["text", "image"]
          : modalities.includes(Capability.Embeddings)
            ? ["text"]
            : ["text"];
  const outputTypes: NonNullable<ModelInfo["outputTypes"]> = modalities.includes(Capability.Transcription)
    ? ["text"]
    : modalities.includes(Capability.Speech)
      ? ["audio"]
      : modalities.includes(Capability.Embeddings)
        ? ["embedding"]
        : modalities.includes(Capability.VideoGenerate)
          ? ["video"]
          : ["image"];

  return withRegistry(
    {
      id: `${provider}:${nativeId}`,
      provider,
      providerModelId: nativeId,
      displayName,
      type: modelType(category),
      capabilities: { modalities },
      pricing: legacyPricing(pricing ?? pricingFor(provider, category, `${provider}:${nativeId}`)),
      inputTypes,
      outputTypes
    },
    { category, provider, developer, family, status: "active", pricing: pricing ?? pricingFor(provider, category, `${provider}:${nativeId}`) }
  );
}

function withRegistry(
  model: ModelInfo & { provider: ProviderId },
  meta: {
    category: RegistryCategory;
    provider: ProviderId;
    developer: string;
    family: string;
    status: RegistryStatus;
    reasoningControl?: string;
    pricing: RegistryPricing;
  }
): RegistryModel {
  const registryReasoning = registryReasoningForModel(model, meta.reasoningControl);
  return {
    ...model,
    registry: {
      category: meta.category,
      status: meta.status,
      developer: meta.developer,
      family: meta.family,
      version: model.providerModelId,
      supportedRegions: [],
      endpoints: endpointsFor(model.capabilities.modalities),
      aliases: [model.providerModelId],
      fallbackModelIds: [],
      verificationLevel: "verifiedDocumentationOnly" satisfies VerificationLevel,
      source: {
        authority: "studio-curated",
        checkedAt: CHECKED_AT,
        urls: SOURCES[meta.provider]
      },
      pricing: meta.pricing,
      reasoning: registryReasoning,
      freeAccess: {
        isFree: model.id.endsWith(":free") || model.providerModelId.endsWith(":free"),
        freeType: model.id.endsWith(":free") || model.providerModelId.endsWith(":free") ? "separate_route" : undefined,
        isPromotional: false
      }
    }
  };
}

function reasoningFeatures(
  efforts: ReasoningFeatures["efforts"],
  source: ReasoningFeatures["source"] = "official-docs",
  confidence: ReasoningFeatures["confidence"] = "exact"
): ReasoningFeatures {
  return efforts.length
    ? {
        supported: true,
        efforts,
        defaultEffort: efforts.includes("medium") ? "medium" : efforts[0],
        source,
        confidence
      }
    : {
        supported: false,
        efforts: [],
        source,
        confidence: source === "unknown" ? "unknown" : confidence
      };
}

function registryReasoningForModel(model: ModelInfo, reasoningControl?: string): RegistryReasoning | undefined {
  const reasoning = model.capabilities.chat?.reasoning;
  if (!reasoning) return undefined;
  return {
    supported: reasoning.supported,
    alwaysOn: reasoning.supported && !reasoning.efforts.includes("none"),
    canDisable: reasoning.efforts.includes("none"),
    effortValues: reasoning.efforts,
    returnsReasoningContent: "unknown",
    reasoningTokensVisible: "unknown",
    reasoningTokensBillable: reasoning.supported ? "unknown" : false,
    worksWithTools: model.capabilities.chat?.tools ? "unknown" : false,
    worksWhileStreaming: model.capabilities.chat?.streaming ? "unknown" : false,
    requiresReasoningStateAfterTools: "unknown",
    reducesOutputBudget: "unknown",
    providerSpecificControls: reasoningControl ? [reasoningControl] : reasoning.supported ? ["reasoning_effort"] : []
  };
}

function endpointsFor(modalities: Capability[]): string[] {
  return modalities.map((capability) => {
    switch (capability) {
      case Capability.Chat:
        return "chat";
      case Capability.Embeddings:
        return "embeddings";
      case Capability.Transcription:
        return "audio.transcriptions";
      case Capability.Speech:
        return "audio.speech";
      case Capability.ImageGenerate:
        return "images.generations";
      case Capability.ImageEdit:
        return "images.edits";
      case Capability.VideoGenerate:
        return "videos.generations";
      case Capability.AudioGenerate:
        return "audio.generations";
      case Capability.Rerank:
        return "rerank";
    }
  });
}

function modelType(category: RegistryCategory): NonNullable<ModelInfo["type"]> {
  if (category === "embeddings") return "embedding";
  if (category === "audio.speech") return "tts";
  if (category === "audio.transcription") return "audio";
  if (category === "video.generation") return "video";
  if (category === "image.generation" || category === "image.editing") return "image";
  return "chat";
}
