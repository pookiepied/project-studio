import type { AgentToolAction, SkillToolAction, ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest } from "../errors";
import type { Env } from "../system/env";

const agentToolActions: AgentToolAction[] = ["spawn_agent", "await_agent", "get_agent_status", "report_back", "read_agent_result", "cancel_agent"];
const skillToolActions: SkillToolAction[] = ["skill_list", "skill_search", "skill_get", "skill_read", "skill_read_resource", "skill_resolve"];

export async function resolveRoute(env: Env, request: ToolExecutionRequest): Promise<ToolRoute> {
  if (request.route) return request.route;
  if (isAgentTool(request.toolName)) return { kind: "agent-runtime", action: request.toolName };
  if (isSkillTool(request.toolName)) return { kind: "skill-library", action: request.toolName };
  const mcpRoute = await resolveMcpRoute(env, request);
  if (mcpRoute) return mcpRoute;
  throw invalidRequest(`No route supplied for tool ${request.toolName}.`);
}

export function targetRef(route: ToolRoute): string {
  switch (route.kind) {
    case "agent-runtime":
      return route.agentId ?? route.action;
    case "skill-library":
      return route.action;
    case "mcp-server":
    case "remote-mcp":
      return `${route.serverId}:${route.toolName ?? ""}`;
    case "native-cloud":
      return `${route.serviceId}:${route.toolName}`;
    case "local-relay":
      return `${route.serverId}:${route.toolName}`;
    case "connector":
      return `${route.connectionId}:${route.slug}`;
    case "memory":
      return `${route.location ?? "cloud"}:${route.operation}`;
  }
}

function isAgentTool(toolName: string): toolName is AgentToolAction {
  return agentToolActions.includes(toolName as AgentToolAction);
}

function isSkillTool(toolName: string): toolName is SkillToolAction {
  return skillToolActions.includes(toolName as SkillToolAction);
}

async function resolveMcpRoute(env: Env, request: ToolExecutionRequest): Promise<ToolRoute | null> {
  const response = await env.REGISTRY.fetch("https://registry/mcp?status=active", {
    headers: { "x-user-id": request.userId },
  });
  if (!response.ok) return null;
  const body = await response.json<{ items?: RegistryMcpRecord[] }>();
  for (const server of body.items ?? []) {
    for (const tool of server.tools.filter((item) => item.enabled)) {
      const namespaced = `mcp_${server.id}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      if (request.toolName === namespaced || request.toolName === tool.name) {
        if (!server.endpointRef) throw invalidRequest(`MCP server ${server.id} does not have an endpointRef.`);
        return { kind: "mcp-server", serverId: server.id, endpoint: server.endpointRef, toolName: tool.name };
      }
    }
  }
  return null;
}

interface RegistryMcpRecord {
  id: string;
  endpointRef?: string;
  tools: Array<{
    name: string;
    enabled: boolean;
  }>;
}
