/**
 * AI service shared types.
 *
 * Single source of truth for message shapes, request/response formats, and
 * the tool-relay contract between the frontend and the AI worker backend.
 * Import from here instead of directly from aiService.ts.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Wire format used by the AI worker for every LLM message role. */
export interface APIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<{
        type: "text" | "image_url";
        text?: string;
        image_url?: { url: string; detail?: "low" | "high" | "auto" };
      }>;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/** Vision message variant used by Ollama's OpenAI-compatible endpoint. */
export type VisionChatMessage = APIChatMessage;

/** Extracts plain text from either a string or a vision content-block array. */
export function extractMessageText(
  content: APIChatMessage["content"] | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const textPart = content.find(
    (p): p is { type: "text"; text: string } => p.type === "text"
  );
  return textPart?.text ?? "";
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool relay
// ---------------------------------------------------------------------------

/**
 * A local tool call the server is asking the client to execute.
 * MCP tools additionally carry `server` and `mcpTool` so the client can
 * route to the correct subprocess without re-parsing the prefixed tool name.
 */
export interface LocalToolCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Present for MCP tools: the server name (e.g. "github"). */
  server?: string;
  /** Present for MCP tools: the bare tool name (e.g. "search_repos"). */
  mcpTool?: string;
}

/** A resolved tool result sent back to the agent. */
export interface ToolResultItem {
  call_id: string;
  content: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Auto-routing
// ---------------------------------------------------------------------------

export interface AutoRoutedInfo {
  tier: string;
  model: string;
  usedFallback: boolean;
  usedEmergency: boolean;
}
