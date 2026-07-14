export enum Capability {
  Chat = "chat",
  Embeddings = "embeddings",
  Rerank = "rerank",
  Transcription = "transcription",
  Speech = "speech",
  ImageGenerate = "image.generate",
  ImageEdit = "image.edit",
  VideoGenerate = "video.generate",
  AudioGenerate = "audio.generate",
  Credits = "credits"
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ReasoningFeatures {
  supported: boolean;
  efforts: ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  source: "live" | "official-docs" | "static-reviewed" | "family-rule" | "unknown";
  confidence?: "exact" | "family" | "unknown";
  reviewedAt?: string;
  note?: string;
}

export interface ChatFeatures {
  streaming: boolean;
  vision: boolean;
  tools: boolean;
  reasoning: ReasoningFeatures;
  jsonSchema: boolean;
  promptCaching: boolean;
}

export interface ModelCapabilities {
  modalities: Capability[];
  chat?: ChatFeatures;
}

export interface ModelPricing {
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  source: "live" | "static" | "unknown";
  note?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  providerModelId: string;
  displayName?: string;
  type?: "audio" | "chat" | "embedding" | "image" | "multimodal" | "tts" | "video";
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  createdAt?: number;
  contextWindow?: number;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsSystemPrompts?: boolean;
  inputTypes?: Array<"text" | "image" | "audio" | "video">;
  outputTypes?: Array<"text" | "image" | "audio" | "video" | "embedding">;
  specialFeatures?: Array<"thinking" | "reasoning" | "code" | "math" | "creative">;
}
