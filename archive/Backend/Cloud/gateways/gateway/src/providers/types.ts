import type {
  ChatRequest,
  ChatResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  ImageEditRequest,
  ImageGenerationRequest,
  MediaResponse,
  SpeechRequest,
  SpeechResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  VideoGenerationRequest,
  VideoGenerationResponse
} from "@/domain/contracts";
import type { Capability } from "@/domain/models/capabilities";
import type { GatewayEnv } from "@/platform/cloudflare/environment";

export interface HandlerContext {
  env: GatewayEnv;
  request: Request;
  executionCtx?: unknown;
}

export type ChatHandler = (request: ChatRequest, context: HandlerContext) => Promise<ChatResponse | Response>;
export type EmbedHandler = (request: EmbeddingsRequest, context: HandlerContext) => Promise<EmbeddingsResponse>;
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

export interface ProviderModule {
  id: string;
  capabilities: Capability[];
  chat?: ChatHandler;
  embed?: EmbedHandler;
  transcribe?: TranscribeHandler;
  speak?: SpeakHandler;
  image?: ImageHandler;
  video?: VideoHandler;
}
