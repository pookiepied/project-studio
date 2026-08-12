/**
 * Provider and model types - comprehensive tagging.
 * Every field that any provider exposes gets a column here.
 * If a provider does not supply it, store null and show N/A in admin.
 * When a new provider introduces a new field, add it here and migrate - discovery populates null for others.
 */

// Protocols - distinct HTTP payload shapes. Collapsed auth wrappers share same string.
export type Protocol = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export type AuthMode = "apiKey" | "vertex-adc";

// Categories - how model is used, for admin filtering and docs.
export type ModelCategory =
  | "text"
  | "image" // generation
  | "embedding"
  | "audio" // music generation
  | "speech" // TTS
  | "transcription" // STT
  | "video"
  | "rerank";

export type Modality = "text" | "image" | "video" | "audio";

// Reasoning - two modes as per spec
export type ReasoningType = "none" | "dynamic" | "selected";

export interface ReasoningConfig {
  type: ReasoningType;
  // Dynamic: slider low/medium/high, provider maps to budgets. Levels vary per model (e.g., xhigh, ultra).
  // Selected: explicit token budgets per level.
  levels: string[]; // e.g., ["low","medium","high"] or ["low","medium","high","xhigh","ultra"]
  // For selected: budgets per level
  budgets?: Record<string, number>;
  // For dynamic: provider docs say low=1k, medium=8k etc - store here if known
  defaultBudgets?: Record<string, number>;
}

export interface ProviderDefinition {
  id: string; // e.g., "anthropic"
  name: string;
  baseUrl: string; // https://api.anthropic.com
  protocol: Protocol;
  authMode: AuthMode;
  enabled: boolean;
}

export interface ModelDefinition {
  // Identity
  id: string; // e.g., "claude-sonnet-4-5"
  providerId: string;
  displayName?: string;
  description?: string;

  // Category and modalities
  category: ModelCategory;
  inputModalities: Modality[];
  outputModalities: Modality[];

  // Capabilities
  contextWindow: number | null; // total tokens
  maxOutputTokens: number | null;
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  reasoning: ReasoningConfig | null;

  // Pricing per 1M tokens USD (null if not supplied)
  pricing: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  } | null;

  // Metadata
  releaseDate?: string | null; // ISO date if known
  // Raw upstream JSON preserved for future fields without migration
  raw?: unknown;
}

// What discovery writes to D1 - includes admin flags
export interface ModelRecord extends ModelDefinition {
  enabled: boolean; // discovered
  exposed: boolean; // admin has explicitly allowed via gateway /v1/models
  fetchedAt: number;
}

// OpenAI-compatible model object for GET /v1/models
export interface OpenAIModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}
