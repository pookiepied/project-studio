import type { Capability } from "./capabilities";
import type {
  ChatRequest,
  ChatResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  RerankRequest,
  RerankResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  SpeechRequest,
  SpeechResponse,
  ImageGenerationRequest,
  ImageEditRequest,
  MediaResponse,
  VideoGenerationRequest,
  VideoGenerationResponse,
  AudioGenerationRequest
} from "./types";
import type { GatewayEnv } from "../system/infrastructure/cloudflare/env";
import { openaiProvider } from "../llm/providers/openai";
import { googleProvider } from "../llm/providers/google";
import { anthropicProvider } from "../llm/providers/anthropic";
import { groqProvider } from "../llm/providers/groq";
import { xaiProvider } from "../llm/providers/xai";
import { deepseekProvider } from "../llm/providers/deepseek";
import { mistralProvider } from "../llm/providers/mistral";
import { falProvider } from "../llm/providers/fal";
import { replicateProvider } from "../llm/providers/replicate";
import { elevenlabsProvider } from "../llm/providers/elevenlabs";
import { openrouterProvider } from "../llm/providers/openrouter";
import { alibabaProvider } from "../llm/providers/alibaba";
import { minimaxProvider } from "../llm/providers/minimax";
import { zaiProvider } from "../llm/providers/zai";
import { xiaomiProvider } from "../llm/providers/xiaomi";
export { getCatalog, getModel } from "../registry";

export interface HandlerContext {
  env: GatewayEnv;
  request: Request;
  executionCtx?: unknown;
}

export type ChatHandler = (request: ChatRequest, context: HandlerContext) => Promise<ChatResponse | Response>;
export type EmbedHandler = (request: EmbeddingsRequest, context: HandlerContext) => Promise<EmbeddingsResponse>;
export type RerankHandler = (request: RerankRequest, context: HandlerContext) => Promise<RerankResponse>;
export type TranscribeHandler = (
  request: TranscriptionRequest,
  context: HandlerContext
) => Promise<TranscriptionResponse>;
export type SpeakHandler = (request: SpeechRequest, context: HandlerContext) => Promise<SpeechResponse>;
export type ImageHandler = (
  request: ImageGenerationRequest | ImageEditRequest,
  context: HandlerContext
) => Promise<MediaResponse>;
export type VideoHandler = (
  request: VideoGenerationRequest,
  context: HandlerContext
) => Promise<VideoGenerationResponse>;
export type AudioGenHandler = (request: AudioGenerationRequest, context: HandlerContext) => Promise<MediaResponse>;
export type CreditsHandler = (context: HandlerContext) => Promise<unknown>;

export interface ProviderModule {
  id: string;
  capabilities: Capability[];
  chat?: ChatHandler;
  embed?: EmbedHandler;
  rerank?: RerankHandler;
  transcribe?: TranscribeHandler;
  speak?: SpeakHandler;
  image?: ImageHandler;
  video?: VideoHandler;
  audioGen?: AudioGenHandler;
  credits?: CreditsHandler;
}

export const providers: ProviderModule[] = [
  openaiProvider,
  googleProvider,
  anthropicProvider,
  groqProvider,
  xaiProvider,
  deepseekProvider,
  mistralProvider,
  falProvider,
  replicateProvider,
  elevenlabsProvider,
  openrouterProvider,
  alibabaProvider,
  minimaxProvider,
  zaiProvider,
  xiaomiProvider
];

export function getProvider(providerId: string): ProviderModule | undefined {
  return providers.find((provider) => provider.id === providerId);
}
