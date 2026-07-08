import type { AgentRunConfig } from "./types";

/**
 * Compose the final system prompt from an agent's base prompt plus the run
 * context the main agent chose for this spawn.
 *
 * The point: a sub-agent should never be oblivious to the constraints it is
 * running under. If the main agent granted it 50 iterations or a 100k token
 * budget, the sub-agent must KNOW that so it can prioritize, pace itself, and —
 * if it needs to — report back to the main agent that it is running short.
 *
 * The base prompt stays a clean static string per agent type (agents/src/agents/
 * {type}/prompt.ts); this builder appends a small, well-formatted "Run context"
 * block so nothing is hardcoded into the prompt itself and the format stays tidy.
 */
export function buildSystemPrompt(base: string, config: AgentRunConfig): string {
  const ctx: string[] = ["## Run context (set by the main agent for this run — honor it)"];

  if (config.maxIterations != null) {
    ctx.push(
      `- Iteration budget: ${config.maxIterations} tool-call rounds. Spend them on the highest-value ` +
      `sub-questions first; do not burn the budget on tangents. If you are running short of the answer, ` +
      `say so clearly in your final report rather than stopping silently.`,
    );
  } else {
    ctx.push(
      `- Iteration budget: unbounded. Still stop as soon as the core question is answered — ` +
      `do not keep exploring for its own sake.`,
    );
  }

  if (config.tokenBudget != null) {
    ctx.push(`- Token budget: approximately ${config.tokenBudget} tokens for the whole run. Be economical; prefer rag over dumping long pages into your reasoning.`);
  }

  ctx.push(`- Model: ${config.model}. Reason properly and carefully — do not be lazy — but keep your final report tight.`);

  if (config.conversationId) {
    ctx.push(
      `- You share a blackboard with the main agent and any sibling agents. Read it before you start ` +
      `to avoid duplicating work, and publish significant findings as you confirm them.`,
    );
  }

  return `${base}\n\n${ctx.join("\n")}`;
}
