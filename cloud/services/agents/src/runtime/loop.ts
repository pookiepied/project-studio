/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type {
  AgentRunConfig,
  AgentLoopResult,
  LLMMessage,
  LLMToolDefinition,
} from "./types";
import type { AgentToolDescriptor } from "../tools/types";
import type { ClientToolBridge } from "../tools/clientBridge";
import { GatewayLLMClient } from "./llmClient";
import { executeAgentTool } from "../tools/executor";
import {
  BLACKBOARD_TOOL_DEFS,
  isBlackboardTool,
  executeBlackboardTool,
} from "./blackboard";
import { emitAgentEvent } from "./tracker";

/**
 * Convert tool descriptors to the OpenAI function-calling format the gateway
 * expects. Only cloud-executable tools are exposed to the LLM — local_mcp tools
 * without an active desktop bridge are filtered out to avoid the model calling
 * something that will always fail.
 */
function toToolDefinitions(
  tools:  AgentToolDescriptor[],
  bridge: ClientToolBridge,
): LLMToolDefinition[] {
  return tools
    .filter(t => t.cloudExecutable || bridge.connected)
    .map(t => ({
      type: "function" as const,
      function: {
        name:        t.name,
        description: t.description,
        parameters:  t.parameters,
      },
    }));
}

/**
 * runAgentLoop — the core ReAct (Reason + Act) loop for a cloud agent.
 *
 * Flow per iteration:
 *   1. Call the LLM with the current message history + tool definitions.
 *   2. If the response has no tool_calls → the agent is done; return.
 *   3. Execute every tool call in the turn (in series — keeps the message
 *      history linear and avoids partial-result confusion).
 *   4. Append the assistant message + tool results to history; loop.
 *
 * Limits:
 *   maxIterations  — stop after N tool-call rounds (not LLM calls).
 *   tokenBudget    — stop when cumulative tokens hit the budget.
 *   Both default to unbounded (undefined). The main agent passes these
 *   flags when spawning a sub-agent for tasks that should be bounded.
 *
 * The onIteration callback is called after each round so the DO can
 * checkpoint its state without breaking out of the loop.
 */
export interface LoopHooks {
  /** Called after each iteration so the DO can checkpoint its state. */
  onIteration?: (iteration: number, totalTokens: number, messages: LLMMessage[]) => Promise<void>;
  /** Gate checked before each LLM step. Return false to stop (e.g. cancelled / superseded). */
  shouldContinue?: () => boolean | Promise<boolean>;
  /** Called just before each (potentially slow) LLM step — used to beat the heartbeat. */
  onBeforeStep?: () => Promise<void> | void;
  /**
   * Resume from a persisted message history instead of building a fresh one.
   * When provided, these ARE the full messages (system prompt already included);
   * config.systemPrompt / config.messages are ignored.
   */
  startMessages?: LLMMessage[];
  /** Iteration count to resume from (so budgets carry across a resume). */
  startIteration?: number;
  /** Cumulative tokens to resume from (so budgets carry across a resume). */
  startTokens?: number;
}

export async function runAgentLoop(
  env:    Env,
  config: AgentRunConfig,
  tools:  AgentToolDescriptor[],
  bridge: ClientToolBridge,
  hooks:  LoopHooks = {},
): Promise<AgentLoopResult> {
  const { onIteration, shouldContinue, onBeforeStep, startMessages, startIteration, startTokens } = hooks;
  const client = new GatewayLLMClient(env.GATEWAY, config.userId);
  const defs   = toToolDefinitions(tools, bridge);

  // Blackboard tools are always available when the agent has a conversation
  // scope — this is the agent-to-agent coordination channel, shared with the
  // main agent and every sibling under the same conversationId.
  const scope = config.conversationId;
  if (scope) defs.push(...BLACKBOARD_TOOL_DEFS);

  // Resume from a checkpoint, or start fresh from the system prompt + task.
  const messages: LLMMessage[] = startMessages
    ? [...startMessages]
    : [{ role: "system", content: config.systemPrompt }, ...config.messages];

  let iteration    = startIteration ?? 0;
  let totalTokens  = startTokens ?? 0;
  let lastContent  = "";

  while (true) {
    // Cancellation / supersede gate — stop cleanly before spending another LLM call.
    if (shouldContinue && !(await shouldContinue())) {
      return { finalMessage: lastContent, iterations: iteration, totalTokens, stopReason: "cancelled" };
    }

    // Beat the heartbeat before the (potentially slow) LLM call so a stall is
    // only ever detected when the run is genuinely dead, not merely thinking.
    await onBeforeStep?.();

    const { message, usage } = await client.complete({
      model:    config.model,
      fallback: config.fallbackModel,
      messages,
      tools:    defs.length ? defs : undefined,
    });

    totalTokens += usage?.total_tokens ?? 0;
    messages.push(message);
    if (message.content) lastContent = message.content;

    // No tool calls → assistant has reasoned to a final answer.
    if (!message.tool_calls?.length) {
      return {
        finalMessage: message.content ?? "",
        iterations:   iteration,
        totalTokens,
        stopReason:   "done",
      };
    }

    // Execute all tool calls in this turn sequentially.
    for (const tc of message.tool_calls) {
      let toolResult: string;
      if (scope && isBlackboardTool(tc.function.name)) {
        let args: unknown = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
        toolResult = await executeBlackboardTool(env, scope, config.runId, tc.function.name, args);
      } else {
        toolResult = await executeTool(env, tools, bridge, tc.function.name, tc.function.arguments, config.userId);
      }
      messages.push({
        role:          "tool",
        content:       toolResult,
        tool_call_id:  tc.id,
      });
    }

    iteration++;

    // Live progress for the UI / notification center.
    emitAgentEvent(env, {
      event:  "agent.iteration",
      userId: config.userId,
      runId:  config.runId,
      data: {
        iteration,
        totalTokens,
        tools: message.tool_calls.map(tc => tc.function.name),
      },
    });

    await onIteration?.(iteration, totalTokens, messages);

    // Check limits — evaluate after the iteration completes so the model at
    // least gets a chance to see the tool results before stopping.
    if (config.maxIterations != null && iteration >= config.maxIterations) {
      return {
        finalMessage: message.content ?? "",
        iterations:   iteration,
        totalTokens,
        stopReason:   "max_iterations",
      };
    }
    if (config.tokenBudget != null && totalTokens >= config.tokenBudget) {
      return {
        finalMessage: message.content ?? "",
        iterations:   iteration,
        totalTokens,
        stopReason:   "token_budget",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function executeTool(
  env:       Env,
  tools:     AgentToolDescriptor[],
  bridge:    ClientToolBridge,
  toolName:  string,
  argsRaw:   string,
  userId:    string,
): Promise<string> {
  const desc = tools.find(t => t.name === toolName);
  if (!desc) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }

  let args: unknown = {};
  try { args = JSON.parse(argsRaw); } catch { /* keep empty object */ }

  try {
    const result = await executeAgentTool(env, desc, args, { userId, bridge });
    return result.success
      ? JSON.stringify(result.data ?? "done")
      : JSON.stringify({ error: result.error });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
