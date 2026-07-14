import type { AgentContext, AgentDefinition } from "../contracts";
import type { Env } from "../system/env";

/**
 * Agent layer: specialized agents available for delegation.
 */
export async function buildAgentContext(
  env: Env,
  userId: string,
  task: string,
): Promise<AgentContext[]> {
  const response = await env.REGISTRY.fetch("http://registry/agents", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry agent lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: AgentDefinition[] }>();
  const tokens = task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  return items.filter((agent) => agent.status === "active" && (tokens.length === 0 || tokens.some((token) => `${agent.name} ${agent.description}`.toLowerCase().includes(token)))).map((agent) => ({
    ref: { id: agent.id, kind: "agent", name: agent.name, scope: agent.ownerType },
    description: agent.description,
    location: "cloud",
    delegatable: true,
  }));
}
