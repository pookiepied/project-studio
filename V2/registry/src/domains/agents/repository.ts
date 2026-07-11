import type { AgentDefinition } from "@studio/v2-contracts";

/**
 * D1 repository for agent definitions (versioned JSON records). Covers both
 * user-created and Studio-provided agents. Every query is user-scoped.
 */

export async function listAgents(
  _db: D1Database,
  _userId: string,
): Promise<AgentDefinition[]> {
  throw new Error("not_implemented");
}

export async function getAgent(
  _db: D1Database,
  _userId: string,
  _agentId: string,
): Promise<AgentDefinition | null> {
  throw new Error("not_implemented");
}
