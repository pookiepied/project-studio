import type { CapabilityExpansion, ExpandToolRequest, ExpandToolResponse } from "../contracts";
import type { Env } from "../system/env";
import { discoverTools } from "../toolPool/client";

export async function expandTool(env: Env, request: ExpandToolRequest): Promise<ExpandToolResponse> {
  const response = await discoverTools(env, {
    userId: request.userId,
    workspaceId: request.workspaceId,
    agentId: request.agentId,
    conversationId: request.conversationId,
    task: request.task ?? "",
    consumer: request.consumer,
    query: request.name,
    type: request.type,
    id: request.id,
    name: request.name,
    category: request.category,
  });
  const matches = Array.isArray((response as { matches?: unknown }).matches)
    ? (response as { matches: CapabilityExpansion["summary"][] }).matches
    : [];
  return {
    query: {
      type: request.type,
      name: request.name,
      id: request.id,
      category: request.category,
    },
    matches: matches.map((summary) => ({ summary })),
  };
}
