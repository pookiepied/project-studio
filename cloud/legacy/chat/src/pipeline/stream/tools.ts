import { ChatPipelineContext } from "../types";
import { CapturedUsage } from "@gateway/providers/types";
import { ToolCall } from "../../agent/state";
import { runAgentLoop, AgentLoopInput } from "../../agent/loop";
import { sseChunk } from "./helpers";
import { logger } from "../../logger";
import { emit } from "../../tracking";

export interface Phase2Result {
  capturedUsage: CapturedUsage | null;
  /** True when the loop exited early via local_tools_pending. */
  localToolsPending: boolean;
  /** Full resolved message history — used for STUDIO Memory processing. */
  resolvedMessages: import("../../agent/state").AgentMessage[];
}

/**
 * Phase 2 — agent loop.
 *
 * Runs when Phase 1 called tools or failed entirely. Injects the Phase 1
 * tool calls as a precomputedAssistantMessage so the LLM step skips a
 * redundant API call and routes straight to tool execution.
 *
 * Concurrently polls AgentContextDO for sub-agent lifecycle events and
 * forwards them as SSE events while the loop yields between iterations.
 */
export async function runPhase2(
  ctx: ChatPipelineContext,
  adapter: import("@gateway/providers/types").ProviderAdapter,
  toolDefs: unknown[],
  toolCallsFromStream: ToolCall[],
  initialUsage: CapturedUsage | null,
  enqueue: (data: string) => void
): Promise<Phase2Result> {
  let capturedUsage = initialUsage;

  const loopInput: AgentLoopInput = {
    messages:            ctx.messages,
    modelId:             ctx.modelId,
    provider:            ctx.provider,
    apiKey:              ctx.apiKey,
    apiBaseUrl:          ctx.apiBaseUrl,
    temperature:         ctx.body.temperature ?? 0.7,
    maxTokens:           ctx.body.max_tokens,
    localEngineConnected: ctx.localEngineConnected,
    runningMcpServers:   ctx.body.running_mcp_servers ?? [],
    tavilyApiKey:        ctx.tavilyApiKey,
    userContext:         ctx.userContext,
    requestId:           ctx.requestId,
    ...(toolCallsFromStream.length > 0
      ? {
          precomputedAssistantMessage: {
            role: "assistant" as const,
            content: null,
            tool_calls: toolCallsFromStream,
          },
        }
      : {}),
  };

  // ── Run the agent loop ────────────────────────────────────────────────────
  // Sub-agent events (research progress) are broadcast directly
  // to WebSocket clients by ChatAgent. No polling needed on the HTTP path —
  // sub-agents require the WebSocket path anyway.
  const loopResult = await runAgentLoop(loopInput, enqueue);

  if (loopResult.capturedUsage) capturedUsage = loopResult.capturedUsage;

  if (loopResult.localToolsPending) {
    emit(ctx.env, ctx.ctx, {
      event:    'agent.local_tools.pending',
      severity: 'info',
      userId:   ctx.userId,
      runId:    ctx.requestId,
      data:     { toolCallCount: 0 /* count is in the SSE payload */ },
    });
    return { capturedUsage, localToolsPending: true, resolvedMessages: loopResult.resolvedMessages };
  }

  // ── Final answer ──────────────────────────────────────────────────────────
  // Extract the last assistant message from the resolved history.
  // Strip it so the final streaming call receives a context ending with a
  // user/tool message (required by strict providers).
  const resolvedMessages = loopResult.resolvedMessages;
  const lastResolved = resolvedMessages[resolvedMessages.length - 1];
  let agentFallbackContent: string | null = null;
  let finalMessages = resolvedMessages;

  if (lastResolved?.role === "assistant" && !lastResolved.tool_calls?.length) {
    if (typeof lastResolved.content === "string") {
      agentFallbackContent = lastResolved.content;
    } else if (Array.isArray(lastResolved.content)) {
      const textPart = lastResolved.content.find(
        (part): part is { type: "text"; text: string } => part.type === "text"
      );
      agentFallbackContent = textPart?.text ?? null;
    }
    finalMessages = resolvedMessages.slice(0, -1);
  }

  if (agentFallbackContent && !loopResult.toolsWereCalled) {
    // Direct stream failed with no tools — emit the agent's buffered answer
    // in synthetic chunks so the client sees streaming behaviour.
    logger.info("Emitting agent fallback answer (direct stream failed)", {
      provider: ctx.provider,
      model: ctx.modelId,
      contentLength: agentFallbackContent.length,
    });
    const chunkSize = 40;
    for (let i = 0; i < agentFallbackContent.length; i += chunkSize) {
      enqueue(sseChunk(ctx.body.model, agentFallbackContent.slice(i, i + chunkSize)));
    }
  } else {
    // Tools were used — stream a fresh final answer with the full tool context.
    logger.info("Streaming final answer after tool execution", {
      provider: ctx.provider,
      model: ctx.modelId,
      messages: finalMessages.length,
    });

    let streamedContent = "";
    try {
      for await (const chunk of adapter.stream({
        model: ctx.modelId,
        messages: finalMessages,
        temperature: ctx.body.temperature ?? 0.7,
        maxTokens: ctx.body.max_tokens,
        // No tools here — forces toolChoice:"none" for the final answer.
        // Sending schemas anyway wastes tokens on every post-tool-execution call.
        captureUsage: (u: CapturedUsage) => { if (!capturedUsage) capturedUsage = u; },
      })) {
        streamedContent += chunk;
        enqueue(sseChunk(ctx.body.model, chunk));
      }
    } catch (streamError: any) {
      logger.warn("Final streaming call failed — will use agent fallback if available", {
        provider: ctx.provider,
        model: ctx.modelId,
        error: streamError?.message,
      });
    }

    if (!streamedContent.trim() && agentFallbackContent?.trim()) {
      logger.warn("Final stream empty, using agent fallback", {
        provider: ctx.provider,
        model: ctx.modelId,
        fallbackLength: agentFallbackContent.length,
      });
      const chunkSize = 40;
      for (let i = 0; i < agentFallbackContent.length; i += chunkSize) {
        enqueue(sseChunk(ctx.body.model, agentFallbackContent.slice(i, i + chunkSize)));
      }
    } else if (!streamedContent.trim() && !agentFallbackContent?.trim()) {
      logger.warn("Both stream and agent fallback empty — emitting structured error", {
        provider: ctx.provider,
        model: ctx.modelId,
      });
      enqueue(JSON.stringify({
        type:    "error",
        code:    "no_response",
        message: "The model didn't return a response. This sometimes happens with models that have limited tool-calling support. Try switching to a different model or provider.",
      }));
    }
  }

  return { capturedUsage, localToolsPending: false, resolvedMessages: loopResult.resolvedMessages };
}
