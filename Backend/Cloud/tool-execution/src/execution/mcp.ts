import type { ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest, upstreamError } from "../errors";

type McpRoute = Extract<ToolRoute, { kind: "mcp-server" | "remote-mcp" }>;

export async function dispatchMcpTool(request: ToolExecutionRequest, route: McpRoute): Promise<unknown> {
  const endpoint = normalizeEndpoint(route.endpoint);
  const toolName = route.toolName ?? request.toolName;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-user-id": request.userId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: request.toolCallId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: request.arguments,
      },
    }),
  });
  const body = await readJson(response);
  if (!response.ok) throw upstreamError("MCP server tool call failed.", body, response.status >= 500);
  if (isJsonRpcError(body)) throw upstreamError("MCP server returned a tool error.", body.error, false);
  return isJsonRpcResult(body) ? body.result : body;
}

function normalizeEndpoint(endpoint: string): string {
  if (!endpoint.startsWith("https://") && !endpoint.startsWith("http://")) {
    throw invalidRequest("MCP endpoint must be an HTTP(S) URL for remote dispatch.");
  }
  return endpoint;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function isJsonRpcResult(value: unknown): value is { result: unknown } {
  return typeof value === "object" && value !== null && "result" in value;
}

function isJsonRpcError(value: unknown): value is { error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}
