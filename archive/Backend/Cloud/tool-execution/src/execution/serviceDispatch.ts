import type { ToolExecutionRequest, ToolRoute } from "../contracts";
import { upstreamError } from "../errors";
import { jsonHeaders } from "../system/http";
import type { Env } from "../system/env";
import { connectorArtifactProposal, redactConnectorResult } from "./connectorArtifacts";

export async function dispatchConnector(env: Env, request: ToolExecutionRequest, route: Extract<ToolRoute, { kind: "connector" }>): Promise<unknown> {
  const response = await env.CONNECTORS.fetch("https://connectors.internal/internal/composio/execute", {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({
      format: "studio.connector-tool-call.v1",
      userId: request.userId,
      conversationId: request.conversationId,
      toolCallId: request.toolCallId,
      slug: route.slug,
      connectionId: route.connectionId,
      entityId: route.entityId,
      args: request.arguments,
      metadata: request.metadata ?? {},
    }),
  });
  const result = await readUpstream(response, "Connectors tool execution failed.");
  const redacted = redactConnectorResult(result);
  return {
    result: redacted,
    redacted,
    artifactProposal: connectorArtifactProposal({
      slug: route.slug,
      toolName: request.toolName,
      result: redacted,
      policyEffect: request.tool?.policy?.effect,
    }),
  };
}

export async function dispatchNativeCloud(env: Env, request: ToolExecutionRequest, route: Extract<ToolRoute, { kind: "native-cloud" }>): Promise<unknown> {
  const response = await env.NATIVE_TOOLS.fetch(`https://native-tools.internal/services/${encodeURIComponent(route.serviceId)}/tools/${encodeURIComponent(route.toolName)}`, {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({
      format: "studio.native-tool-call.v1",
      userId: request.userId,
      conversationId: request.conversationId,
      toolCallId: request.toolCallId,
      arguments: request.arguments,
      metadata: request.metadata ?? {},
    }),
  });
  return readUpstream(response, "Native cloud tool execution failed.");
}

export async function dispatchMemory(env: Env, request: ToolExecutionRequest, route: Extract<ToolRoute, { kind: "memory" }>): Promise<unknown> {
  const response = await env.MEMORY.fetch(`https://memory.internal/operations/${encodeURIComponent(route.operation)}`, {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({
      format: "studio.memory-tool-call.v1",
      userId: request.userId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      toolCallId: request.toolCallId,
      location: route.location ?? "cloud",
      arguments: request.arguments,
      metadata: request.metadata ?? {},
    }),
  });
  return readUpstream(response, "Memory tool execution failed.");
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
