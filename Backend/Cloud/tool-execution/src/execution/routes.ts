import type { AgentToolAction, SkillToolAction, ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest } from "../errors";

const agentToolActions: AgentToolAction[] = ["spawn_agent", "await_agent", "get_agent_status", "report_back", "read_agent_result", "cancel_agent"];
const skillToolActions: SkillToolAction[] = ["skill_list", "skill_search", "skill_get", "skill_read", "skill_read_resource", "skill_resolve"];

export function resolveRoute(request: ToolExecutionRequest): ToolRoute {
  if (request.route) return request.route;
  if (isAgentTool(request.toolName)) return { kind: "agent-runtime", action: request.toolName };
  if (isSkillTool(request.toolName)) return { kind: "skill-library", action: request.toolName };
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
