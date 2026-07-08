import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolContext, ToolResult } from "../base/types";
import { getRequestEnv } from "../../context";
import { getChatAgent } from "../../agent/ChatAgent";

interface AgentMetadata {
  type: string;
  description: string;
  capabilities: string[];
  recommended_for: string;
}

// Runtime-spawnable agent types that live in the studio-agents Worker. Each
// entry mirrors a BaseAgentDO subclass there. Keep in sync with the agents
// worker's registry (agents/src/agents/registry.ts).
export const AGENT_TYPES: Record<string, AgentMetadata> = {
  research: {
    type: "research",
    description:
      "Autonomous online research agent. Searches the web, reads sources in full, " +
      "verifies claims across independent sources, and returns a structured, cited report.",
    capabilities: ["web_search", "web_fetch", "rag", "http_request"],
    recommended_for:
      "Multi-source web research, competitive analysis, gathering and verifying facts from 3+ sources.",
  },
};

// Scoped by requestId to prevent cross-request name collisions in long-lived isolates.
const NAME_REGISTRY = new Map<string, Map<string, string>>();

export function resolveAgentName(name: string, requestId: string): string | undefined {
  return NAME_REGISTRY.get(requestId)?.get(name);
}

function registerAgentName(name: string, agentId: string, requestId: string): void {
  if (!NAME_REGISTRY.has(requestId)) NAME_REGISTRY.set(requestId, new Map());
  NAME_REGISTRY.get(requestId)!.set(name, agentId);
}

interface SpawnArgs {
  action?:         string;
  description?:    string;
  task?:           string;
  agent_type?:     string;
  name?:           string;
  context?:        string;
  model?:          string;
  max_iterations?: number;
  token_budget?:   number;
}

export class SpawnAgentTool extends BaseTool {
  readonly name = "spawn_agent";
  readonly executionTarget = "cloud" as const;
  readonly group = "agentic" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = false;

  readonly description =
    "Spawn a cloud research sub-agent to investigate a topic in parallel while you keep working. " +
    "USE FOR: multi-source web research, competitive analysis, or any fact-finding needing 3+ sources — " +
    "delegate it so it runs in its own clean context off your conversation. " +
    "spawn_agent returns immediately with {status:'running', agent_id}. Spawn all agents you need, " +
    "then call await_agents with their IDs to collect the reports. Use action='list' to see agent types.";

  readonly parameters = Type.Object({
    action: Type.Optional(
      Type.Union([Type.Literal("spawn"), Type.Literal("list")], {
        description: "'spawn' creates and runs a sub-agent (default). 'list' shows available agent types.",
        default: "spawn",
      })
    ),
    description: Type.Optional(
      Type.String({
        description:
          "A short (3-5 word) summary of the task, used for notifications and progress. " +
          "Required when action='spawn'. Example: 'Research Gemini pricing'.",
      })
    ),
    task: Type.Optional(
      Type.String({
        description:
          "Complete, self-contained description of what to research. The sub-agent has NO access to " +
          "this conversation — include every fact, constraint, and piece of context it needs. Required when action='spawn'.",
      })
    ),
    agent_type: Type.Optional(
      Type.Literal("research", {
        description: "Agent type to spawn. Currently only 'research' (online research + synthesis).",
        default: "research",
      })
    ),
    model: Type.Optional(
      Type.String({
        description:
          "Which model tier the sub-agent should use — pick by task weight, not by name:\n" +
          "  'quick'    — fast + cheap, for light lookups / short syntheses.\n" +
          "  'balanced' — strong reasoning at sane cost (DEFAULT; good for most research).\n" +
          "  'deep'     — maximum capability, for hard/ambiguous multi-step research.\n" +
          "  'inherit'  — use the same model you (the main agent) are currently on.\n" +
          "You may also pass an explicit 'provider:model' if you know exactly what you want. " +
          "Omit to use 'balanced'.",
      })
    ),
    max_iterations: Type.Optional(
      Type.Number({
        description:
          "Cap the sub-agent's tool-call rounds. Omit for unbounded (runs until it has a complete answer). " +
          "Set low (e.g. 6-8) for a quick scan, higher (20+) for deep research. Range: 1-100.",
        minimum: 1,
        maximum: 100,
      })
    ),
    token_budget: Type.Optional(
      Type.Number({
        description:
          "Optional cumulative token budget. The sub-agent stops once it reaches this many tokens. " +
          "Omit for unbounded. Use to bound cost on exploratory tasks.",
        minimum: 1000,
      })
    ),
    name: Type.Optional(
      Type.String({
        description:
          "Optional addressable name for this agent (e.g. 'research-pricing'). " +
          "Use when you want to reference this specific agent later. Unique per conversation turn.",
      })
    ),
    context: Type.Optional(
      Type.String({
        description:
          "Summary of what you or sibling agents already know that is relevant. " +
          "Prepended to the task so the sub-agent avoids duplicating work.",
      })
    ),
  });

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    const { action = "spawn" } = args as { action?: string };

    switch (action) {
      case "spawn": return this.executeSpawn(args as SpawnArgs, context);
      case "list":  return this.executeList();
      default:      return this.errorResult(`Unknown action: '${action}'. Valid: spawn, list`);
    }
  }

  private async executeSpawn(args: SpawnArgs, context?: ToolContext): Promise<ToolResult> {
    const { description, task, name, context: parentContext, model, max_iterations, token_budget } = args;
    const agentType = args.agent_type ?? "research";

    if (!task || typeof task !== "string") {
      return this.errorResult("'task' is required and must be a string describing what to research.");
    }
    if (!AGENT_TYPES[agentType]) {
      return this.errorResult(`Unknown agent type '${agentType}'. Available: ${Object.keys(AGENT_TYPES).join(", ")}`);
    }

    const env    = getRequestEnv();
    const agents = env?.AGENTS as Fetcher | undefined;
    if (!agents) {
      return this.errorResult("AGENTS service binding not configured — studio-agents Worker not wired in wrangler.toml.");
    }

    const uc             = context?.userContext as Record<string, unknown> | undefined;
    const inheritModel   = uc?._agentModel as string | undefined;
    const conversationId = getChatAgent()?.name;

    const fullTask = parentContext
      ? `${task}\n\n--- Context from the main agent ---\n${parentContext}`
      : task;

    try {
      const resp = await agents.fetch(
        new Request(`http://studio-agents/agents/${agentType}/spawn`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            ...(uc?.userId ? { "X-User-Id": String(uc.userId) } : {}),
          },
          body: JSON.stringify({
            task:           fullTask,
            description:    description ?? task.slice(0, 100),
            model,
            inheritModel,
            conversationId,
            maxIterations:  max_iterations,
            tokenBudget:    token_budget,
          }),
        }),
      );

      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        return this.errorResult(`Failed to spawn ${agentType} agent (HTTP ${resp.status}): ${detail.slice(0, 200)}`);
      }

      const body = await resp.json() as { runId?: string; model?: string };
      const runId = body.runId;
      if (!runId) return this.errorResult("Spawn endpoint did not return a runId.");

      if (name) {
        const requestId = uc?._requestId as string ?? "";
        registerAgentName(name, runId, requestId);
      }

      return this.successResult({
        status:      "running",
        agent_id:    runId,
        agent_type:  agentType,
        model:       body.model,
        description: description ?? task.slice(0, 60),
        message:     "Research agent is running. Use await_agents with this agent_id to collect the report.",
        ...(name ? { name } : {}),
      });
    } catch (e: any) {
      return this.errorResult(`Failed to spawn ${agentType} agent: ${e?.message ?? String(e)}`);
    }
  }

  private executeList(): ToolResult {
    const agents = Object.values(AGENT_TYPES).map(meta => ({
      type: meta.type,
      description: meta.description,
      capabilities: meta.capabilities,
      recommended_for: meta.recommended_for,
    }));

    return this.successResult({
      available_agents: agents,
      total: agents.length,
      usage:
        "Call spawn action with 'task' + 'description' (and optional 'model' tier, 'max_iterations', 'token_budget'). " +
        "Each agent runs a durable ReAct loop in a Cloudflare Durable Object. " +
        "spawn_agent returns immediately — use await_agents to collect results.",
    });
  }
}

export const spawnAgentTool = new SpawnAgentTool();
