import type { ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest, notImplemented, upstreamError } from "../errors";
import { jsonHeaders } from "../system/http";
import type { Env } from "../system/env";

type AgentRoute = Extract<ToolRoute, { kind: "agent-runtime" }>;

export async function dispatchAgentRuntime(env: Env, request: ToolExecutionRequest, route: AgentRoute): Promise<unknown> {
  switch (route.action) {
    case "spawn_agent":
      return spawnAgent(env, request, route);
    case "get_agent_status":
      return agentState(env, request);
    case "read_agent_result":
    case "await_agent":
      return agentResult(env, request);
    case "cancel_agent":
      return cancelAgent(env, request);
    case "report_back":
      throw notImplemented("report_back requires Agent Runtime report storage endpoints before it can be executed.");
  }
}

async function spawnAgent(env: Env, request: ToolExecutionRequest, route: AgentRoute): Promise<unknown> {
  const agentId = stringArg(request, "agentId", route.agentId);
  const task = stringArg(request, "task");
  const conversationId = stringArg(request, "conversationId", request.conversationId);
  const response = await env.AGENT_RUNTIME.fetch(`https://agent-runtime/invoke/${encodeURIComponent(agentId)}`, {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({
      conversationId,
      task,
      context: optionalStringArg(request, "context"),
      modelId: optionalStringArg(request, "modelId"),
      idempotencyKey: request.idempotencyKey ?? request.toolCallId,
      branchId: optionalStringArg(request, "branchId"),
      turnId: request.toolCallId,
      permissions: objectArg(request, "permissions"),
      limits: objectArg(request, "limits"),
      definition: objectArg(request, "definition"),
    }),
  });
  return readUpstream(response, "Agent Runtime spawn failed.");
}

async function agentState(env: Env, request: ToolExecutionRequest): Promise<unknown> {
  const agentId = stringArg(request, "agentId");
  const conversationId = stringArg(request, "conversationId", request.conversationId);
  const response = await env.AGENT_RUNTIME.fetch(`https://agent-runtime/invoke/${encodeURIComponent(agentId)}/${encodeURIComponent(conversationId)}`, {
    headers: { "x-user-id": request.userId },
  });
  return readUpstream(response, "Agent Runtime status lookup failed.");
}

async function agentResult(env: Env, request: ToolExecutionRequest): Promise<unknown> {
  const agentId = stringArg(request, "agentId");
  const conversationId = stringArg(request, "conversationId", request.conversationId);
  const response = await env.AGENT_RUNTIME.fetch(`https://agent-runtime/invoke/${encodeURIComponent(agentId)}/${encodeURIComponent(conversationId)}/result`, {
    headers: { "x-user-id": request.userId },
  });
  return readUpstream(response, "Agent Runtime result lookup failed.");
}

async function cancelAgent(env: Env, request: ToolExecutionRequest): Promise<unknown> {
  const agentId = stringArg(request, "agentId");
  const conversationId = stringArg(request, "conversationId", request.conversationId);
  const response = await env.AGENT_RUNTIME.fetch(`https://agent-runtime/invoke/${encodeURIComponent(agentId)}/${encodeURIComponent(conversationId)}/cancel`, {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({ reason: optionalStringArg(request, "reason") ?? "cancelled by parent tool call" }),
  });
  return readUpstream(response, "Agent Runtime cancel failed.");
}

async function readUpstream(response: Response, message: string): Promise<unknown> {
  const data = await readJson(response);
  if (!response.ok) throw upstreamError(message, data, response.status >= 500);
  return data;
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

function stringArg(request: ToolExecutionRequest, name: string, fallback?: string): string {
  const value = request.arguments[name] ?? fallback;
  if (typeof value !== "string" || value.trim() === "") throw invalidRequest(`${name} is required for ${request.toolName}.`);
  return value;
}

function optionalStringArg(request: ToolExecutionRequest, name: string): string | undefined {
  const value = request.arguments[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidRequest(`${name} must be a string.`);
  return value;
}

function objectArg(request: ToolExecutionRequest, name: string): Record<string, unknown> | undefined {
  const value = request.arguments[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw invalidRequest(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
