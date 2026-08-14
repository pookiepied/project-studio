/**
 * Provider runtime contract — one place per provider.
 * Every provider (anthropic/google/openai/third-party) implements this via SDK + custom fallback + quirks.
 */

import type { ModelDefinition, Protocol } from "./types.ts";

export type ReasoningRequest =
  | { mode: "default" }
  | { mode: "none" }
  | { mode: "adaptive"; level?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" }
  | { mode: "budget"; budgetTokens: number };

export interface ChatRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol: Protocol };
  apiKey: string;
  // OpenAI-compatible body — we normalize this to AI SDK or custom transport
  body: Record<string, unknown>;
  signal: AbortSignal;
  reasoning?: ReasoningRequest;
}

export interface ImageRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol: Protocol };
  apiKey: string;
  prompt: string;
  // OpenAI image params
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface SpeechRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol?: Protocol };
  apiKey: string;
  input: string;
  voice?: string;
  responseFormat?: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface TranscriptionRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol?: Protocol };
  apiKey: string;
  form: FormData;
  signal: AbortSignal;
}

export interface EmbeddingRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol?: Protocol };
  apiKey: string;
  input: string | string[];
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface VideoRequest {
  model: ModelDefinition;
  provider: { id: string; baseUrl: string; protocol?: Protocol };
  apiKey: string;
  prompt: string | { text: string; image?: string; images?: string[] };
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface DocumentPreprocessRequest {
  mimeType: string;
  bytes: Uint8Array;
  filename?: string;
  targetModel: ModelDefinition;
}

/**
 * Single entry per provider — SDK, custom, quirks, capabilities live together.
 * Methods throw NOT_IMPLEMENTED if the provider doesn't support the operation.
 */
export interface ProviderRuntime {
  readonly providerId: string;
  readonly protocol: Protocol;
  // Text
  chat(req: ChatRequest): Promise<Response>;
  // Images
  generateImage?(req: ImageRequest): Promise<Response>;
  // Audio
  generateSpeech?(req: SpeechRequest): Promise<Response>;
  transcribe?(req: TranscriptionRequest): Promise<Response>;
  // Embeddings
  embed?(req: EmbeddingRequest): Promise<Response>;
  // Video (async jobs handled via Workers, polling inside runtime)
  generateVideo?(req: VideoRequest): Promise<Response>;
  // Discovery
  discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]>;
  // Document smart preprocessing (OCR/vision fallback)
  preprocessDocument?(req: DocumentPreprocessRequest): Promise<{ text: string; pages?: number; via: string }>;
}

// Shared helpers
export function isReasoningRequest(v: unknown): v is ReasoningRequest {
  return !!v && typeof v === "object" && "mode" in (v as Record<string, unknown>);
}
