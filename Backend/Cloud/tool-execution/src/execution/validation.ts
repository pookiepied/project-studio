import type { AgentToolAction, SkillToolAction, SourceRuntime, ToolExecutionBatchRequest, ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest } from "../errors";

const sourceRuntimes = new Set<SourceRuntime>(["execution", "planner", "agent"]);
const agentActions = new Set<AgentToolAction>(["spawn_agent", "await_agent", "get_agent_status", "report_back", "read_agent_result", "cancel_agent"]);
const skillActions = new Set<SkillToolAction>(["skill_list", "skill_search", "skill_get", "skill_read", "skill_read_resource", "skill_resolve"]);

export function normalizeExecutionRequest(value: unknown, inherited?: Partial<ToolExecutionRequest>): ToolExecutionRequest {
  const input = readObject(value);
  const userId = string(input.userId ?? inherited?.userId, "userId");
  const sourceRuntime = sourceRuntimeValue(input.sourceRuntime ?? inherited?.sourceRuntime);
  const toolCallId = string(input.toolCallId, "toolCallId");
  const toolName = string(input.toolName, "toolName");
  const args = input.arguments === undefined ? {} : readObject(input.arguments);
  return {
    userId,
    sourceRuntime,
    workspaceId: optionalString(input.workspaceId ?? inherited?.workspaceId, "workspaceId"),
    sessionId: optionalString(input.sessionId ?? inherited?.sessionId, "sessionId"),
    conversationId: optionalString(input.conversationId ?? inherited?.conversationId, "conversationId"),
    agentId: optionalString(input.agentId ?? inherited?.agentId, "agentId"),
    agentExecutionId: optionalString(input.agentExecutionId ?? inherited?.agentExecutionId, "agentExecutionId"),
    parentExecutionId: optionalString(input.parentExecutionId ?? inherited?.parentExecutionId, "parentExecutionId"),
    toolCallId,
    jobId: optionalString(input.jobId, "jobId"),
    idempotencyKey: optionalString(input.idempotencyKey, "idempotencyKey"),
    toolName,
    arguments: args,
    route: normalizeRoute(input.route),
    timeoutMs: optionalNumber(input.timeoutMs, "timeoutMs"),
    metadata: input.metadata === undefined ? undefined : readObject(input.metadata),
  };
}

export function normalizeBatchRequest(value: unknown): ToolExecutionBatchRequest {
  const input = readObject(value);
  const calls = input.calls;
  if (!Array.isArray(calls)) throw invalidRequest("calls must be an array.");
  if (calls.length < 1 || calls.length > 20) throw invalidRequest("calls must contain between 1 and 20 tool calls.");
  const base = {
    userId: string(input.userId, "userId"),
    sourceRuntime: sourceRuntimeValue(input.sourceRuntime),
    workspaceId: optionalString(input.workspaceId, "workspaceId"),
    sessionId: optionalString(input.sessionId, "sessionId"),
    conversationId: optionalString(input.conversationId, "conversationId"),
    agentId: optionalString(input.agentId, "agentId"),
    agentExecutionId: optionalString(input.agentExecutionId, "agentExecutionId"),
    parentExecutionId: optionalString(input.parentExecutionId, "parentExecutionId"),
  };
  return {
    ...base,
    calls: calls.map((call) => normalizeExecutionRequest(call, base)),
  };
}

function normalizeRoute(value: unknown): ToolRoute | undefined {
  if (value === undefined) return undefined;
  const route = readObject(value);
  const kind = string(route.kind, "route.kind");
  switch (kind) {
    case "agent-runtime":
      return { kind, action: agentAction(route.action), agentId: optionalString(route.agentId, "route.agentId") };
    case "skill-library":
      return { kind, action: skillAction(route.action) };
    case "mcp-server":
    case "remote-mcp":
      return {
        kind,
        serverId: string(route.serverId, "route.serverId"),
        endpoint: string(route.endpoint, "route.endpoint"),
        toolName: optionalString(route.toolName, "route.toolName"),
      };
    case "native-cloud":
      return { kind, serviceId: string(route.serviceId, "route.serviceId"), toolName: string(route.toolName, "route.toolName") };
    case "local-relay":
      return {
        kind,
        serverId: string(route.serverId, "route.serverId"),
        toolName: string(route.toolName, "route.toolName"),
        localRegistrationId: optionalString(route.localRegistrationId, "route.localRegistrationId"),
      };
    case "connector":
      return {
        kind,
        slug: string(route.slug, "route.slug"),
        connectionId: string(route.connectionId, "route.connectionId"),
        entityId: string(route.entityId, "route.entityId"),
      };
    case "memory":
      return {
        kind,
        operation: string(route.operation, "route.operation"),
        location: route.location === "cloud" || route.location === "local" ? route.location : undefined,
      };
    default:
      throw invalidRequest(`Unsupported route kind: ${kind}`);
  }
}

function agentAction(value: unknown): AgentToolAction {
  const action = string(value, "route.action") as AgentToolAction;
  if (agentActions.has(action)) return action;
  throw invalidRequest(`Unsupported agent action: ${action}`);
}

function skillAction(value: unknown): SkillToolAction {
  const action = string(value, "route.action") as SkillToolAction;
  if (skillActions.has(action)) return action;
  throw invalidRequest(`Unsupported skill action: ${action}`);
}

function sourceRuntimeValue(value: unknown): SourceRuntime {
  const runtime = string(value, "sourceRuntime") as SourceRuntime;
  if (!sourceRuntimes.has(runtime)) throw invalidRequest("sourceRuntime must be execution, planner, or agent.");
  return runtime;
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest("Expected an object.");
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalidRequest(`${field} is required.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidRequest(`${field} must be a string.`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidRequest(`${field} must be a finite number.`);
  return value;
}
