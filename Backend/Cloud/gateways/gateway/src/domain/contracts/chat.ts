import type { ReasoningEffort } from "@/domain/models/capabilities";
import type { ProviderId } from "./providers";

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
