import { Capability, type ReasoningEffort } from "../../core/capabilities";
import type {
  RegistryCategory,
  RegistryPricingKind,
  RegistryPricingStatus,
  RegistryPricingUnit,
  RegistryStatus
} from "../../registry/schema";

export const registryManagementSchema = {
  modelTypes: [
    "text.chat",
    "image.generation",
    "image.editing",
    "video.generation",
    "audio.speech",
    "audio.transcription",
    "audio.generation",
    "embeddings",
    "reranking",
    "specialized"
  ] satisfies RegistryCategory[],
  statuses: ["active", "preview", "beta", "experimental", "deprecated", "disabled"] satisfies RegistryStatus[],
  capabilities: Object.values(Capability),
  pricing: {
    kinds: ["token", "image", "video", "audio", "embedding", "rerank", "runtime", "custom"] satisfies RegistryPricingKind[],
    statuses: ["verified", "unknown", "not_applicable", "estimated", "provider_variable"] satisfies RegistryPricingStatus[],
    units: [
      "one_million_tokens",
      "image",
      "megapixel",
      "generation",
      "video_second",
      "audio_minute",
      "audio_hour",
      "character",
      "prediction",
      "compute_second",
      "credit",
      "request",
      "not_applicable"
    ] satisfies RegistryPricingUnit[]
  },
  reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"] satisfies ReasoningEffort[]
};
