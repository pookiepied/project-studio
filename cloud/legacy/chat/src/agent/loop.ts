/**
 * Agent loop — explicit ReAct (Reason + Act) loop.
 *
 * Replaces the LangGraph StateGraph. The same logic that was spread across
 * graph.ts + state.ts + node functions is now a plain while loop that is easy
 * to read, debug, and extend.
 *
 * Loop structure:
 *
 *   START
 *     │
 *     └─(normal turn)──> llmStep
 *                           │
 *                           ├─(no tool calls)──> END (stream final answer)
 *                           │
 *                           └─(tool calls)──> toolsStep
 *                                                │
 *                                                ├─(local tools pending)──> emit local_tools_pending → END
 *                                                │
 *                                                └─(all cloud)──> back to llmStep
 *
 * SSE events emitted:
 *   tool_start         — LLM requested a tool call
 *   tool_complete      — a cloud tool finished
 *   local_tools_pending — local/MCP tools deferred to Tauri; includes full
 *                         message history + specialist payload so the client
 *                         can resume without any server-side state
 */

import type { AgentMessage, AgentStateType, ToolCall } from "./state";
import type { CapturedUsage } from "@gateway/providers/types";
import { runLlmStep } from "./steps/llm";
import { runToolsStep } from "./steps/tools";
import { safeParseArgs, serializeToolCall, emitToolCompletes } from "../pipeline/stream/helpers";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Input to the agent loop — mirrors the former AgentInput from helpers.ts
 * plus the specialist resume payload when the client echoes one back.
 */
export interface AgentLoopInput {
  messages: AgentMessage[];
  modelId: string;
  provider: string;
  apiKey: string;
  apiBaseUrl: string;
  temperature: number;
  maxTokens?: number;
  localEngineConnected: boolean;
  runningMcpServers?: string[];
  tavilyApiKey: string;
  userContext: unknown;
  requestId: string;
  /** Precomputed assistant message from Phase 1 (avoids a redundant API call). */
  precomputedAssistantMessage?: AgentMessage | null;
}

export interface AgentLoopResult {
  /** Usage from the last LLM step inside the loop (not the final streaming answer). */
  capturedUsage: CapturedUsage | null;
  /** True when the loop stopped early because local tools need Tauri execution. */
  localToolsPending: boolean;
  /** Final message history after all tool execution — used to stream the answer. */
  resolvedMessages: AgentMessage[];
  /** True if at least one tool call was made during this loop run. */
  toolsWereCalled: boolean;
}

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

/**
 * Run the ReAct agent loop.
 *
 * Emits SSE events via `enqueue` throughout execution. Returns a result
 * object so the caller (phase2.ts) can stream the final answer and record
 * usage.
 */
export async function runAgentLoop(
  input: AgentLoopInput,
  enqueue: (data: string) => void
): Promise<AgentLoopResult> {
  let messages: AgentMessage[] = [...input.messages];
  let capturedUsage: CapturedUsage | null = null;
  let toolsWereCalled = false;
  let precomputedMessage: AgentMessage | null = input.precomputedAssistantMessage ?? null;

  // ── Main ReAct loop ─────────────────────────────────────────────────────
  // Build the state object the step functions expect.
  // Updated as the loop progresses — messages accumulate, precomputed cleared.
  const buildState = (): AgentStateType => ({
    messages,
    modelId:                    input.modelId,
    provider:                   input.provider,
    apiKey:                     input.apiKey,
    apiBaseUrl:                 input.apiBaseUrl,
    temperature:                input.temperature,
    maxTokens:                  input.maxTokens,
    localEngineConnected:       input.localEngineConnected,
    runningMcpServers:          input.runningMcpServers ?? [],
    tavilyApiKey:               input.tavilyApiKey,
    userContext:                input.userContext as any,
    requestId:                  input.requestId,
    precomputedAssistantMessage: precomputedMessage,
    pendingClientToolCalls:     [],
  });

  while (true) {
    // ── LLM step ─────────────────────────────────────────────────────────
    // Pass enqueue so runLlmStep streams tokens in real-time via streamFull()
    // instead of waiting for the full response with complete(). Each token
    // arrives at the client as it is generated — no single-chunk dump at end.
    const llmResult = await runLlmStep(buildState(), enqueue);
    const assistantMsg = llmResult.message;
    if (llmResult.capturedUsage) capturedUsage = llmResult.capturedUsage;

    // Clear precomputed message — only used on the first iteration
    precomputedMessage = null;

    messages = [...messages, assistantMsg];

    // No tool calls → LLM produced a final answer; exit the loop.
    // Content was already streamed token-by-token inside runLlmStep.
    if (!assistantMsg.tool_calls?.length) {
      break;
    }

    // Emit tool_start for every tool call the LLM requested
    toolsWereCalled = true;
    for (const tc of assistantMsg.tool_calls) {
      enqueue(
        JSON.stringify({
          type:   "tool_start",
          callId: tc.id,
          tool:   tc.function?.name,
          args:   safeParseArgs(tc.function?.arguments),
        })
      );
    }

    // ── Tools step ────────────────────────────────────────────────────────
    const toolsResult = await runToolsStep(buildState());

    // Append cloud results + relay messages to history
    const newMessages = [...toolsResult.toolMessages, ...toolsResult.relayMessages];
    messages = [...messages, ...newMessages];

    // Emit tool_complete for every finished cloud tool
    emitToolCompletes(enqueue, toolsResult.toolMessages);

    // Check for local tools deferred to Tauri
    if (toolsResult.pendingClientToolCalls.length > 0) {
      enqueue(
        JSON.stringify({
          type:      "local_tools_pending",
          messages,
          toolCalls: toolsResult.pendingClientToolCalls.map((tc: ToolCall) =>
            serializeToolCall(tc)
          ),
        })
      );
      return { capturedUsage, localToolsPending: true, resolvedMessages: messages, toolsWereCalled: true };
    }

    // All cloud tools done — loop back for the next LLM turn
    logger.info("Agent loop: tool step complete, continuing", {
      cloudTools:   toolsResult.toolMessages.length,
      relayMessages: toolsResult.relayMessages.length,
    });
  }

  return { capturedUsage, localToolsPending: false, resolvedMessages: messages, toolsWereCalled };
}
