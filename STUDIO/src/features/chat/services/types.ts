/**
 * AI service shared types.
 *
 * Runtime / tool-relay types (APIChatMessage, extractMessageText, LocalToolCall,
 * ToolResultItem, AutoRoutedInfo) now live in `@/types/chat` — the neutral leaf
 * both `runtime/` and `features/chat/` import downward (D-9). They are
 * re-exported below for back-compat; importers should switch to `@/types/chat`.
 *
 * The HTTP chat shapes (ChatRequest / ChatResponse / TranscribeResponse /
 * VisionChatMessage) stay here until Phase 3 moves them to
 * `features/chat/services/types.ts`.
 */

export { extractMessageText } from "@/types/chat";
export type {
  APIChatMessage,
  LocalToolCall,
  ToolResultItem,
  AutoRoutedInfo,
} from "@/types/chat";

import type { APIChatMessage } from "@/types/chat";

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

/** Vision message variant used by Ollama's OpenAI-compatible endpoint. */
export type VisionChatMessage = APIChatMessage;

export interface ChatRequest {
  model: string;
  messages: APIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  local_engine_connected?: boolean;
  /** Names of MCP servers currently running on the client. */
  running_mcp_servers?: string[];
  /** Bypass the agent loop — direct single-turn provider call (rephrase, etc.). */
  direct?: boolean;
  max_iterations?: number;
  /**
   * Serialised Cloud Coding Agent relay state echoed back from a prior
   * `local_tools_pending` event. When present the Worker skips Phase 1 and
   * resumes the specialist directly.
   */
  pending_specialist?: Record<string, unknown>;
  /**
   * Extended-thinking / reasoning budget in tokens.
   * Preset levels: low=4096, medium=8192, high=16384.
   * Omit to use the provider default.
   */
  reasoning_budget?: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: APIChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface TranscribeResponse {
  text: string;
  language?: string;
}
