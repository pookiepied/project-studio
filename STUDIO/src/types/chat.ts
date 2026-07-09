/**
 * Shared chat / tool-relay types.
 *
 * Neutral leaf imported by BOTH the Local Runtime (`runtime/`) and the chat
 * feature, so neither layer has to import "upward" across the other (D-9).
 * Runtime-only wire types (ChatRequestBody, AgentChatHandlers, the WS envelope)
 * live in `runtime/protocol.ts`; the HTTP chat shapes (ChatRequest/Response)
 * stay in `services/ai/types.ts` until Phase 3.
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
