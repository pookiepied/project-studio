import type { CapabilityExpansion, ExpandToolRequest, ExpandToolResponse } from "../contracts";
import type { Env } from "../system/env";
import { assembleContext } from "../assembly/assemble";

export async function expandTool(env: Env, request: ExpandToolRequest): Promise<ExpandToolResponse> {
  const context = await assembleContext(env, {
    userId: request.userId,
    workspaceId: request.workspaceId,
    agentId: request.agentId,
    conversationId: request.conversationId,
    taskId: request.taskId ?? `expand:${request.name ?? request.id ?? request.type ?? "all"}`,
    task: request.task ?? "",
    consumer: request.consumer,
  });

  const expansions = context.capabilityCatalog
    .filter((summary) => request.type === undefined || request.type === "all" || summary.type === request.type)
    .filter((summary) => !request.id || summary.id === request.id || summary.parentId === request.id)
    .filter((summary) => !request.name || summary.name === request.name || summary.toolName === request.name)
    .filter((summary) => !request.category || summary.category === request.category)
    .map((summary): CapabilityExpansion => {
      const tool = context.tools.find((item) => item.name === summary.name || item.name === summary.toolName);
      return {
        summary,
        tool,
        details: detailsFor(summary.type, summary.id, context),
      };
    });

  return {
    query: {
      type: request.type,
      name: request.name,
      id: request.id,
      category: request.category,
    },
    matches: expansions,
  };
}

function detailsFor(type: string, id: string, context: Awaited<ReturnType<typeof assembleContext>>): Record<string, unknown> | undefined {
  if (type === "mcp-server") return asRecord(context.mcp.find((item) => item.ref.id === id));
  if (type === "skill") return asRecord(context.skills.find((item) => item.ref.id === id));
  if (type === "agent") return asRecord(context.agents.find((item) => item.ref.id === id));
  if (type === "connector") return asRecord(context.connectors.find((item) => item.ref.id === id));
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return value as Record<string, unknown>;
}
