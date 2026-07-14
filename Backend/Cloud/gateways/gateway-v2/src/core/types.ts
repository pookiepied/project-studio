import type { ReasoningEffort } from "./capabilities";

export type ProviderId =
  | "openai"
  | "google"
  | "anthropic"
  | "groq"
  | "xai"
  | "deepseek"
  | "mistral"
  | "fal"
  | "replicate"
  | "elevenlabs"
  | "openrouter"
  | "alibaba"
  | "minimax"
  | "zai"
  | "xiaomi";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  image: string;
  mediaType?: string;
}

export type ChatMessageContent = string | Array<TextPart | ImagePart>;

export interface ChatMessage {
  role: MessageRole;
  content: ChatMessageContent;
  name?: string;
  toolCallId?: string;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  topP?: number;
  top_p?: number;
  maxTokens?: number;
  max_tokens?: number;
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;
  tool_choice?: "auto" | "none" | "required" | Record<string, unknown>;
  responseFormat?: {
    type: "json_object" | "json_schema";
    json_schema?: Record<string, unknown>;
  };
  response_format?: {
    type: "json_object" | "json_schema";
    json_schema?: Record<string, unknown>;
  };
  reasoningEffort?: ReasoningEffort;
  reasoning_effort?: ReasoningEffort;
  reasoningBudget?: number;
  reasoning_budget?: number;
  previousResponseId?: string;
  previous_response_id?: string;
  promptCacheKey?: string;
  prompt_cache_key?: string;
  user?: string;
}

export interface ChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: unknown[];
  };
  finish_reason: string | null;
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  provider: ProviderId;
  choices: ChatChoice[];
  usage?: unknown;
}

export interface CapturedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
  cost?: number;
  id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type StreamEvent =
  | { type: "content"; chunk: string }
  | { type: "reasoning"; chunk: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage"; data: CapturedUsage };

export interface EmbeddingsRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  user?: string;
}

export interface EmbeddingsResponse {
  object: "list";
  model: string;
  data: Array<{
    object: "embedding";
    index: number;
    embedding: number[];
  }>;
  usage?: unknown;
}

export interface RerankRequest {
  model: string;
  query: string;
  documents: string[];
}

export interface RerankResponse {
  model: string;
  results: unknown[];
}

export interface TranscriptionRequest {
  model: string;
  audio: ArrayBuffer;
  mediaType?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  timestampGranularities?: Array<"word" | "segment">;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: unknown[];
}

export interface SpeechRequest {
  model: string;
  input: string;
  voice: string;
  responseFormat?: string;
  response_format?: string;
  instructions?: string;
  speed?: number;
  language?: string;
}

export interface SpeechResponse {
  audio: ArrayBuffer;
  mediaType: string;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  responseFormat?: "url" | "b64_json";
  response_format?: "url" | "b64_json";
  quality?: string;
  background?: string;
  outputFormat?: string;
  output_format?: string;
  outputCompression?: number;
  output_compression?: number;
  user?: string;
}

export interface ImageEditRequest extends ImageGenerationRequest {
  images: ArrayBuffer[];
  mask?: ArrayBuffer;
  inputFidelity?: "low" | "high";
  input_fidelity?: "low" | "high";
}

export interface MediaResponse {
  bytes?: ArrayBuffer;
  base64?: string;
  url?: string;
  mediaType?: string;
  items?: MediaResponse[];
  usage?: unknown;
}

export interface VideoGenerationRequest {
  model: string;
  // Text prompt. Required for text-to-video; optional for image-to-video (where the image
  // drives the clip and text merely guides it). The route enforces "prompt or image".
  prompt?: string;
  // Optional image input for image-to-video (base64 or data URL / http URL). When present
  // the provider generates a clip animated from this still frame instead of pure text-to-video.
  image?: string;
  n?: number;
  aspectRatio?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  seed?: number;
  generateAudio?: boolean;
  generate_audio?: boolean;
}

export interface VideoGenerationResponse {
  // The AI SDK's experimental_generateVideo blocks until the clip is ready and returns the
  // bytes directly (it polls the provider queue internally), so the gateway returns finished
  // media pass-through. jobId is retained for any future truly-async provider path.
  jobId?: string;
  media?: MediaResponse;
}

export interface AudioGenerationRequest {
  model: string;
  prompt: string;
}
