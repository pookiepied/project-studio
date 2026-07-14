/**
 * await_agents — wait for sub-agents spawned by spawn_agent to finish and collect results.
 *
 * Polls each agent's Durable Object in the studio-agents Worker via the AGENTS
 * service binding. The agent type is inferred from the runId prefix
 * ("research-…" → the research agent's DO namespace).
 *
 * Workflow:
 *   1. Parent calls spawn_agent N times → each returns a runId (agent_id)
 *   2. Parent calls await_agents({agent_ids:[...]}) → polls all in parallel
 *   3. Returns full results when all agents reach a terminal status
 */

import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import type { ToolContext, ToolResult } from "../base/types";
import { getRequestEnv } from "../../context";

// ---------------------------------------------------------------------------
// Types — mirror the agents worker's AgentState (agents/src/runtime/types.ts)
// ---------------------------------------------------------------------------

interface AgentState {
  status:      "idle" | "running" | "done" | "failed" | "cancelled";
  iteration:   number;
  totalTokens: number;
  result?:     string;
  error?:      string;
  startedAt?:  number;
  finishedAt?: number;
  config?:     { messages?: Array<{ content?: string }> };
}

interface AgentOutcome {
  agent_id:     string;
  status:       "completed" | "failed" | "running" | "not_found" | "cancelled";
  content?:     string;
  summary?:     string;
  error?:       string;
  iterations?:  number;
  tokens?:      number;
  duration_ms?: number;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class AwaitAgentsTool extends BaseTool {
  readonly name            = "await_agents";
  readonly executionTarget = "cloud" as const;
  readonly group           = "agentic" as const;
  readonly tier            = 2 as const;
  readonly allowInSubAgent = false;

  readonly description =
    "Wait for one or more sub-agents spawned by spawn_agent to complete and return their reports. " +
    "ALWAYS call this after spawning — spawn_agent returns immediately with agent_id(s), and " +
    "await_agents is how you collect the actual output. Pass all agent_ids at once to wait in parallel.";

  readonly parameters = Type.Object({
    agent_ids: Type.Array(Type.String(), {
      description:
        "List of agent_id values returned by spawn_agent. Pass ALL pending IDs in one call — " +
        "the tool waits for them in parallel.",
      minItems: 1,
    }),
    timeout_seconds: Type.Optional(
      Type.Number({
        description: "Maximum seconds to wait before returning partial results. Default: 180.",
        default: 180,
        minimum: 10,
        maximum: 600,
      })
    ),
  });

  async execute(args: unknown, _context?: ToolContext): Promise<ToolResult> {
    const { agent_ids, timeout_seconds = 180 } = args as {
      agent_ids: string[];
      timeout_seconds?: number;
    };

    if (!agent_ids?.length) {
      return this.errorResult("'agent_ids' must be a non-empty array of agent ID strings.");
    }

    const env    = getRequestEnv();
    const agents = env?.AGENTS as Fetcher | undefined;
    if (!agents) {
      return this.errorResult(
        "await_agents: AGENTS service binding not configured. Ensure studio-agents Worker is wired in wrangler.toml."
      );
    }

    const deadline         = Date.now() + timeout_seconds * 1000;
    const POLL_INTERVAL_MS = 2000;

    while (Date.now() < deadline) {
      const statusMap = await fetchAllStatuses(agent_ids, agents);
      if (agent_ids.every(id => isTerminal(statusMap.get(id) ?? null))) {
        const outcomes = buildOutcomes(agent_ids, statusMap);
        return this.successResult({
          all_completed: outcomes.every(o => o.status === "completed"),
          agents:        outcomes,
          message:       buildSummaryMessage(outcomes),
        });
      }
      await sleep(POLL_INTERVAL_MS);
    }

    const finalStatusMap = await fetchAllStatuses(agent_ids, agents);
    const outcomes       = buildOutcomes(agent_ids, finalStatusMap);
    return this.successResult({
      all_completed: false,
      timed_out:     true,
      timeout_seconds,
      agents:        outcomes,
      message:
        `Timeout after ${timeout_seconds}s. ` +
        `${outcomes.filter(o => o.status === "completed").length}/${agent_ids.length} agents completed.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer the agent type (and thus DO route) from a runId of the form "{type}-{uuid}". */
function agentTypeFromRunId(runId: string): string {
  return runId.split("-")[0] ?? "research";
}

async function fetchAllStatuses(agentIds: string[], agents: Fetcher): Promise<Map<string, AgentState | null>> {
  const statuses = await Promise.all(agentIds.map(id => pollStatus(id, agents)));
  const map = new Map<string, AgentState | null>();
  agentIds.forEach((id, i) => map.set(id, statuses[i] ?? null));
  return map;
}

async function pollStatus(runId: string, agents: Fetcher): Promise<AgentState | null> {
  try {
    const type = agentTypeFromRunId(runId);
    const resp = await agents.fetch(
      new Request(`http://studio-agents/agents/${type}/${runId}/status`, { method: "GET" })
    );
    if (!resp.ok) return null;
    const body = await resp.json() as { state?: AgentState };
    return body.state ?? null;
  } catch {
    return null;
  }
}

function isTerminal(s: AgentState | null): boolean {
  if (!s) return true;
  return s.status === "done" || s.status === "failed" || s.status === "cancelled";
}

function buildOutcomes(agentIds: string[], statusMap: Map<string, AgentState | null>): AgentOutcome[] {
  return agentIds.map((id): AgentOutcome => {
    const s = statusMap.get(id) ?? null;
    if (!s) return { agent_id: id, status: "not_found" };

    const base = {
      agent_id:    id,
      iterations:  s.iteration,
      tokens:      s.totalTokens,
      duration_ms: s.finishedAt && s.startedAt ? s.finishedAt - s.startedAt : undefined,
    };

    if (s.status === "done") {
      const content = s.result ?? "";
      return {
        ...base,
        status:  "completed",
        content: content.length > 8000 ? content.slice(0, 8000) + "\n\n*(output truncated)*" : content,
        summary: content.slice(0, 400),
      };
    }
    if (s.status === "failed")    return { ...base, status: "failed", error: s.error };
    if (s.status === "cancelled") return { ...base, status: "cancelled", error: "Agent was cancelled." };
    return { ...base, status: "running" };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildSummaryMessage(outcomes: AgentOutcome[]): string {
  const done   = outcomes.filter(o => o.status === "completed").length;
  const failed = outcomes.filter(o => o.status === "failed").length;
  const total  = outcomes.length;
  if (failed === 0) return `All ${total} agent${total !== 1 ? "s" : ""} completed successfully.`;
  return `${done}/${total} agents completed. ${failed} failed.`;
}

export const awaitAgentsTool = new AwaitAgentsTool();
