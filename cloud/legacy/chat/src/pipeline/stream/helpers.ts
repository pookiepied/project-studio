import { AgentMessage, ToolCall } from "../../agent/state";

/** Build an OpenAI-format SSE delta chunk. */
export function sseChunk(model: string, content: string): string {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
}

/** Parse tool call arguments safely — returns {} on invalid JSON. */
export function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Parse an MCP tool name into its server and tool components.
 * Convention: mcp_{server}__{tool}  e.g. "mcp_github__search_repos"
 */
export function parseMcpToolName(name: string): { server: string; mcpTool: string } | null {
  if (!name.startsWith("mcp_")) return null;
  const withoutPrefix = name.slice(4);
  const sep = withoutPrefix.indexOf("__");
  if (sep === -1) return null;
  // Restore hyphens: DynamicMCPTool sanitizes server names by replacing hyphens with underscores
  const server = withoutPrefix.slice(0, sep).replace(/_/g, "-");
  return { server, mcpTool: withoutPrefix.slice(sep + 2) };
}

/** Build a serialisable tool call descriptor for the local_tools_pending event. */
export function serializeToolCall(tc: ToolCall): Record<string, unknown> {
  const mcp = parseMcpToolName(tc.function.name);
  return {
    callId: tc.id,
    tool: tc.function.name,
    args: safeParseArgs(tc.function.arguments),
    ...(mcp && { server: mcp.server, mcpTool: mcp.mcpTool }),
  };
}

/** Emit tool_complete SSE events for a batch of tool result messages. */
export function emitToolCompletes(
  enqueue: (data: string) => void,
  messages: AgentMessage[]
): void {
  for (const msg of messages) {
    if (msg.role === "tool") {
      let result: unknown = msg.content;
      try {
        result = JSON.parse(msg.content as string);
      } catch {
        // keep as string
      }
      enqueue(
        JSON.stringify({
          type: "tool_complete",
          callId: msg.tool_call_id,
          tool: msg.name,
          result,
        })
      );
    }
  }
}
