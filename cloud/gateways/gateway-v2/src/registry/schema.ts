import type { Capability, ModelInfo, ReasoningEffort } from "../core/capabilities";
import type { ProviderId } from "../core/types";

export type RegistryCategory =
  | "text.chat"
  | "image.generation"
  | "image.editing"
  | "video.generation"
  | "audio.speech"
  | "audio.transcription"
  | "audio.generation"
  | "embeddings"
  | "reranking"
  | "specialized";

export type RegistryStatus = "active" | "preview" | "beta" | "experimental" | "deprecated" | "disabled";

export type VerificationLevel = "manual" | "verifiedDocumentationOnly" | "testedApiBehavior" | "productionApproved";
export type RegistryPricingStatus = "verified" | "unknown" | "not_applicable" | "estimated" | "provider_variable";
export type RegistryPricingKind = "token" | "image" | "video" | "audio" | "embedding" | "rerank" | "runtime" | "custom";
export type RegistryPricingUnit =
  | "one_million_tokens"
  | "image"
  | "megapixel"
  | "generation"
  | "video_second"
  | "audio_minute"
  | "audio_hour"
  | "character"
  | "prediction"
  | "compute_second"
  | "credit"
  | "request"
  | "not_applicable";

export interface RegistrySource {
  authority: "studio-curated";
  checkedAt: string;
  urls: string[];
  notes?: string;
}

export interface RegistryReasoning {
  supported: boolean;
  alwaysOn: boolean;
  canDisable: boolean;
  effortValues: ReasoningEffort[];
  returnsReasoningContent: boolean | "unknown";
  reasoningTokensVisible: boolean | "unknown";
  reasoningTokensBillable: boolean | "unknown";
  worksWithTools: boolean | "unknown";
  worksWhileStreaming: boolean | "unknown";
  requiresReasoningStateAfterTools: boolean | "unknown";
  reducesOutputBudget: boolean | "unknown";
  providerSpecificControls?: string[];
}

export interface RegistryFreeAccess {
  isFree: boolean;
  freeType?: "permanent" | "promotional" | "monthly_quota" | "trial" | "separate_route" | "zero_priced_route";
  freeQuota?: number;
  freeQuotaUnit?: string;
  freeUntil?: string;
  freeRateLimits?: string;
  requiresPaymentMethod?: boolean;
  isPromotional?: boolean;
}

export interface RegistryPricingTier {
  name: string;
  unit: RegistryPricingUnit;
  price: number | null;
  currency: string;
  appliesWhen?: string;
}

export interface RegistryPricing {
  kind: RegistryPricingKind;
  status: RegistryPricingStatus;
  currency: string;
  billingUnit: RegistryPricingUnit;
  inputPerMillion?: number | null;
  cachedInputPerMillion?: number | null;
  cacheWritePerMillion?: number | null;
  outputPerMillion?: number | null;
  price?: number | null;
  tiers?: RegistryPricingTier[];
  batchInputPerMillion?: number | null;
  batchOutputPerMillion?: number | null;
  longContext?: RegistryPricingTier[];
  reasoningTokens?: "included" | "billed_as_output" | "separate" | "unknown" | "not_applicable";
  toolUseCharges?: RegistryPricingTier[];
  dependsOn?: Array<"duration" | "resolution" | "fps" | "quality" | "hardware" | "provider_route" | "region">;
  region?: string;
  originalUnit?: string;
  sourceUrls: string[];
  verifiedAt: string | null;
  notes?: string;
}

export interface RegistryMetadata {
  category: RegistryCategory;
  status: RegistryStatus;
  developer: string;
  family: string;
  version?: string;
  releaseDate?: string;
  deprecationDate?: string;
  supportedRegions?: string[];
  endpoints: string[];
  aliases: string[];
  fallbackModelIds: string[];
  verificationLevel: VerificationLevel;
  source: RegistrySource;
  pricing: RegistryPricing;
  reasoning?: RegistryReasoning;
  freeAccess?: RegistryFreeAccess;
}

export type RegistryModel = ModelInfo & {
  provider: ProviderId;
  capabilities: ModelInfo["capabilities"] & {
    modalities: Capability[];
  };
  registry: RegistryMetadata;
};

export interface RegistryProviderSummary {
  provider: ProviderId;
  status: "active" | "disabled";
  modelCount: number;
  categories: RegistryCategory[];
}

export interface ModelRegistry {
  version: string;
  generatedAt: string;
  source: "studio-curated";
  models: RegistryModel[];
  providers: RegistryProviderSummary[];
}
