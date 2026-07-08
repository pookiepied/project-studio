/**
 * cancel_agent — signal a running sub-agent to stop.
 *
 * Routes the cancel request to the studio-agents Worker via the AGENTS service binding.
 * The agent checks the cancel flag between steps and transitions to "cancelled".
 *
 * Only the orchestrating (parent) agent may cancel sub-agents.
 */

import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolContext, ToolResult } from "../base/types";
import { getRequestEnv } from "../../context";

export class CancelAgentTool extends BaseTool {
  readonly name = "cancel_agent";
  readonly executionTarget = "cloud" as const;
  readonly group = "agentic" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = false;

  readonly description =
    "Send a cancellation signal to a running sub-agent spawned by spawn_agent. " +
    "The agent will stop between its current step and the next one, " +
    "and its status will change to 'cancelled'. " +
    "Use this when you no longer need a result, want to save resources, or detect that an agent is stuck.";

  readonly parameters = Type.Object({
    agent_id: Type.String({
      description: "The agent_id returned by spawn_agent for the agent you want to cancel.",
    }),
    reason: Type.Optional(
      Type.String({
        description:
          "Optional human-readable reason for the cancellation. " +
          "Shown in logs and events.",
      })
    ),
  });

  async execute(args: unknown, _context?: ToolContext): Promise<ToolResult> {
    const { agent_id, reason } = args as { agent_id: string; reason?: string };

    if (!agent_id?.trim()) {
      return this.errorResult("'agent_id' is required.");
    }

    const env    = getRequestEnv();
    const agents = env?.AGENTS as Fetcher | undefined;

    if (!agents) {
      return this.errorResult(
        "cancel_agent: AGENTS service binding not configured. " +
        "Ensure studio-agents Worker is wired in wrangler.toml."
      );
    }

    // Agent type is the runId prefix, e.g. "research-ab12cd34" → "research".
    const agentType = agent_id.split("-")[0] ?? "research";

    try {
      const resp = await agents.fetch(
        new Request(`http://studio-agents/agents/${agentType}/${agent_id}/cancel`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    reason ? JSON.stringify({ reason }) : "{}",
        }),
      );

      if (resp.status === 404) {
        return this.errorResult(`Agent '${agent_id}' not found.`);
      }

      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        return this.errorResult(`Cancel failed (HTTP ${resp.status}): ${detail.slice(0, 200)}`);
      }

      return this.successResult({
        cancelled: true,
        agent_id,
        message: reason
          ? `Cancellation signal sent to '${agent_id}'. Reason: ${reason}`
          : `Cancellation signal sent to '${agent_id}'. The agent will stop at its next checkpoint.`,
      });
    } catch (e: any) {
      return this.errorResult(`Failed to cancel agent '${agent_id}': ${e?.message ?? String(e)}`);
    }
  }
}

export const cancelAgentTool = new CancelAgentTool();
