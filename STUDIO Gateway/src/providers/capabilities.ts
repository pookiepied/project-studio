/**
 * Capability matrix — provider and model level.
 * Catalog gives us model metadata, but runtime capability is what we have actually implemented and tested.
 */

export type Operation =
  | "chat"
  | "chat.stream"
  | "tools"
  | "tools.parallel"
  | "vision"
  | "vision.pdf"
  | "reasoning.adaptive"
  | "reasoning.budget"
  | "reasoning.none"
  | "image.generate"
  | "image.edit"
  | "image.variation"
  | "audio.speech"
  | "audio.transcription"
  | "audio.translation"
  | "audio.music"
  | "embeddings"
  | "embeddings.multimodal"
  | "video.generate"
  | "video.imageToVideo"
  | "document.ocr"
  | "document.smart";

export interface ModelCapabilities {
  // Resolved from catalog + static fallback
  category: import("./types.ts").ModelCategory;
  inputModalities: import("./types.ts").Modality[];
  outputModalities: import("./types.ts").Modality[];
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  reasoningType: import("./types.ts").ReasoningType | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface ProviderCapabilities {
  providerId: string;
  operations: Set<Operation>;
  // Which AI SDK provider package backs this provider (if any)
  sdkPackage?: string;
  // Whether this provider is verified via tests
  verified: boolean;
  notes?: string;
}

// Known provider capability presets — used for admin UI filtering and route validation
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  anthropic: {
    providerId: "anthropic",
    operations: new Set<Operation>([
      "chat", "chat.stream", "tools", "tools.parallel", "vision",
      "reasoning.adaptive", "reasoning.budget", "reasoning.none",
    ]),
    sdkPackage: "@ai-sdk/anthropic",
    verified: false,
  },
  google: {
    providerId: "google",
    operations: new Set<Operation>([
      "chat", "chat.stream", "tools", "tools.parallel", "vision",
      "reasoning.adaptive", "reasoning.budget"
    ]),
    sdkPackage: "@ai-sdk/google",
    verified: false,
  },
  openai: {
    providerId: "openai",
    operations: new Set<Operation>([
      "chat", "chat.stream", "tools", "tools.parallel", "vision",
      "reasoning.adaptive", "reasoning.none",
      "image.generate",
      "audio.speech", "audio.transcription",
      "embeddings",
    ]),
    sdkPackage: "@ai-sdk/openai",
    verified: false,
  },
  fal: {
    providerId: "fal",
    operations: new Set<Operation>([
      "chat", "chat.stream", "image.generate", "video.generate", "video.imageToVideo",
      "audio.speech", "audio.transcription",
    ]),
    sdkPackage: "@ai-sdk/fal",
    verified: false,
    notes: "Fal — image/video via fal SDK, chat via openai-compatible, audio via fal",
  },
  elevenlabs: {
    providerId: "elevenlabs",
    operations: new Set<Operation>([
      "audio.speech", "audio.transcription",
    ]),
    sdkPackage: "@ai-sdk/elevenlabs",
    verified: false,
    notes: "ElevenLabs — speech/transcription only, chat intentionally unsupported",
  },
};

// Generic openai-compatible providers inherit this plus model-specific features
export function capabilitiesForOpenAICompatible(providerId: string): ProviderCapabilities {
  return {
    providerId,
    operations: new Set<Operation>([
      "chat", "chat.stream", "tools", "vision", "reasoning.adaptive", "embeddings"
    ]),
    sdkPackage: "@ai-sdk/openai-compatible",
    verified: false,
    notes: "Generic OpenAI-compatible — quirks may apply, video/audio not assumed",
  };
}

export function supportsOperation(caps: ProviderCapabilities, op: Operation): boolean {
  return caps.operations.has(op);
}
