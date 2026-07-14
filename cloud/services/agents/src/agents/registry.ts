/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

/**
 * Agent-type registry — the single source of truth for which agent types exist
 * and which Durable Object namespace backs each one.
 *
 * Adding a new agent type is: build its folder under agents/src/agents/{type}/,
 * add the DO binding in wrangler.toml + env.ts, and add one line here.
 */

export type AgentType = "research";

export const AGENT_TYPES: AgentType[] = ["research"];

export function isAgentType(value: string): value is AgentType {
  return (AGENT_TYPES as string[]).includes(value);
}

/** Map an agent type to its DO namespace, or null if unknown. */
export function getAgentNamespace(env: Env, agentType: string): DurableObjectNamespace | null {
  switch (agentType) {
    case "research": return env.RESEARCH_AGENT;
    default:         return null;
  }
}

/** Infer the agent type from a runId of the form "{type}-{uuid}". */
export function agentTypeFromRunId(runId: string): AgentType | null {
  const prefix = runId.split("-")[0] ?? "";
  return isAgentType(prefix) ? prefix : null;
}
