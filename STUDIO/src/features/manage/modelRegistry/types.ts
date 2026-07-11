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

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
  batchInputPerMillion?: number | null;
  batchOutputPerMillion?: number | null;
  reasoningTokens?: "included" | "billed_as_output" | "separate" | "unknown" | "not_applicable";
  dependsOn?: string[];
  sourceUrls: string[];
  verifiedAt: string | null;
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

export interface RegistryModel {
  id: string;
  provider: string;
  providerModelId: string;
  displayName?: string;
  type?: string;
  contextWindow?: number;
  maxTokens?: number;
  inputTypes?: string[];
  outputTypes?: string[];
  capabilities: {
    modalities: string[];
    chat?: {
      streaming: boolean;
      vision: boolean;
      tools: boolean;
      jsonSchema: boolean;
      promptCaching: boolean;
      reasoning: {
        supported: boolean;
        efforts: ReasoningEffort[];
        defaultEffort?: ReasoningEffort;
        source: string;
        confidence?: string;
      };
    };
  };
  registry: {
    category: RegistryCategory;
    status: string;
    developer: string;
    family: string;
    version?: string;
    endpoints: string[];
    aliases: string[];
    fallbackModelIds: string[];
    verificationLevel: string;
    pricing: RegistryPricing;
    reasoning?: RegistryReasoning;
    freeAccess?: {
      isFree: boolean;
      freeType?: string;
    };
    source: {
      checkedAt: string;
      urls: string[];
      notes?: string;
    };
  };
}

export interface ModelRegistry {
  version?: string;
  registryVersion?: string;
  generatedAt?: string;
  generated_at?: string;
  source: string;
  data?: RegistryModel[];
  models?: RegistryModel[];
}

export interface RegistryManagementSchema {
  modelTypes: RegistryCategory[];
  statuses: string[];
  capabilities: string[];
  pricing: {
    kinds: RegistryPricingKind[];
    statuses: RegistryPricingStatus[];
    units: RegistryPricingUnit[];
  };
  reasoningEfforts: ReasoningEffort[];
}
