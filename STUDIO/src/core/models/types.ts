export interface Model {
  id: string;
  provider: string;
  type: "audio" | "chat" | "embedding" | "image" | "multimodal" | "tts" | "video";
  name: string;
  description?: string;
  maxTokens?: number;
  contextWindow?: number;
  pricing?: {
    input: number;
    output: number;
    currency?: string;
  };
  free?: boolean;
  rateLimit?: {
    rpm: number;
    rpd: number;
  };
  availableFrom?: string[];
  primarySource?: string;
  alternativeSources?: string[];
  capabilities?: string[];
  modality?: string[];
  architecture?: string;
  created?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsSystemPrompts?: boolean;
  inputTypes?: ("text" | "image" | "audio" | "video")[];
  outputTypes?: ("text" | "image" | "audio" | "video")[];
  maxImageSize?: number;
  maxImages?: number;
  languages?: string[];
  specialFeatures?: ("thinking" | "reasoning" | "code" | "math" | "creative")[];
}

export interface ProviderInfo {
  provider: string;
  status: "active" | "inactive" | "error";
  lastChecked: string;
  apiKeyValid: boolean;
  modelCount: number;
  errorMessage?: string;
}

export interface ModelsResponse {
  models: Model[];
  providers: Record<string, ProviderInfo>;
  lastUpdated: string;
  totalModels: number;
  uniqueModels: number;
}
