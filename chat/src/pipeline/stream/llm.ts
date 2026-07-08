import { ChatPipelineContext } from "../types";
import { CapturedUsage } from "@gateway/providers/types";
import { ToolCall } from "../../agent/state";
import { sseChunk } from "./helpers";
import { logger } from "../../logger";

export interface Phase1Result {
  toolCallsFromStream: ToolCall[];
  directStreamFailed: boolean;
  directStreamHadContent: boolean;
  capturedUsage: CapturedUsage | null;
  hadReasoning: boolean;
}

/**
 * Phase 1 — direct streaming.
 *
 * Calls the provider with streamFull() and pipes tokens to the client
 * immediately (real TTFT). If the model issues tool calls instead of
 * answering, those are captured and returned so Phase 2 can execute them
 * without a redundant LLM call.
 *
 * If the stream errors after content has already been sent, the error is
 * surfaced via directStreamFailed=true and the caller must close the stream
 * (partial content cannot be restarted). If it errors before any content is
 * sent, directStreamFailed=true triggers a full fallback to Phase 2.
 */
export async function runPhase1(
  ctx: ChatPipelineContext,
  adapter: import("@gateway/providers/types").ProviderAdapter,
  toolDefs: unknown[],
  enqueue: (data: string) => void
): Promise<Phase1Result> {
  let directStreamFailed = false;
  let directStreamHadContent = false;
  let toolCallsFromStream: ToolCall[] = [];
  let capturedUsage: CapturedUsage | null = null;
  let hadReasoning = false;

  try {
    for await (const event of adapter.streamFull({
      model: ctx.modelId,
      messages: ctx.messages,
      temperature: ctx.body.temperature ?? 0.7,
      maxTokens: ctx.body.max_tokens,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      toolChoice: toolDefs.length > 0 ? "auto" : undefined,
      reasoningBudget: ctx.reasoningBudget,
    })) {
      if (event.type === "content") {
        directStreamHadContent = true;
        enqueue(sseChunk(ctx.body.model, event.chunk));
      } else if (event.type === "reasoning") {
        if (!hadReasoning) {
          // Signal to the client that extended thinking has started
          enqueue(JSON.stringify({ type: "thinking" }));
          hadReasoning = true;
        }
        // Stream each reasoning chunk as a distinct event
        enqueue(JSON.stringify({ type: "thinking_delta", chunk: event.chunk }));
      } else if (event.type === "tool_calls") {
        toolCallsFromStream = event.calls;
      } else if (event.type === "usage") {
        capturedUsage = event.data;
      }
    }
  } catch (streamErr: any) {
    directStreamFailed = true;
    if (directStreamHadContent) {
      logger.warn("Direct stream failed after emitting content — cannot restart", {
        provider: ctx.provider,
        model: ctx.modelId,
        error: streamErr?.message,
      });
    } else {
      logger.warn("Direct stream failed before content, falling back to agent loop", {
        provider: ctx.provider,
        model: ctx.modelId,
        error: streamErr?.message,
      });
    }
  }

  return { toolCallsFromStream, directStreamFailed, directStreamHadContent, capturedUsage, hadReasoning };
}
