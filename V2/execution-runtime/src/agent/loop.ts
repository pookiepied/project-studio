import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type {
  ExecutionLimits,
  RunStatus,
  RuntimeEventPayloads,
  RuntimeEventType,
} from "@studio/v2-contracts";
import type { Env } from "../system/env";
import { gatewayModel } from "../gateway/client";

/**
 * The main agent loop (ARCHITECTURE.md §3): a ReAct-style reason → act →
 * observe cycle. The Vercel AI SDK drives what happens inside a step
 * (streaming, parallel tool calls, reasoning); this module translates stream
 * parts into Studio Runtime Protocol events and hands control points back to
 * the caller.
 *
 * The loop is deliberately state-free: durable state, retries, and lifecycle
 * live in the ExecutionSession DO. The loop only reports and obeys.
 */

/** Persist-then-broadcast a protocol event. The session stamps identity. */
export type EmitFn = <T extends RuntimeEventType>(
  type: T,
  payload: RuntimeEventPayloads[T],
) => void | Promise<void>;

/** What the loop knows at a checkpoint boundary (RUNTIME-CHECKLIST.md §6). */
export interface CheckpointData {
  nextStepNumber: number;
  messages: ModelMessage[];
  partialAssistantText: string;
  completedToolCallIds: string[];
  pendingToolCallIds: string[];
}

export interface LoopHooks {
  emit: EmitFn;
  /** Called after each completed step with everything needed to resume. */
  checkpoint(data: CheckpointData): void | Promise<void>;
  /**
   * The loop reports which working phase it is in (reasoning / responding /
   * tool_calls_pending / tools_running); the session decides whether the
   * transition is legal and persists it. Redundant reports are ignored there.
   */
  phase(status: RunStatus): void | Promise<void>;
  /** Called when the loop observes work that may count against optional limits. */
  observe(event: LoopObservation): void | Promise<void>;
}

export type LoopObservation =
  | { type: "model_step"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "tool_call"; toolCallId: string; toolName: string; input: unknown };

export interface LoopInput {
  runId: string;
  attemptId: string;
  modelId: string;
  system: string;
  /** Conversation so far — on resume, restored from the latest checkpoint. */
  messages: ModelMessage[];
  tools: ToolSet;
  limits?: ExecutionLimits;
  abortSignal: AbortSignal;
}

export interface LoopResult {
  text: string;
  messages: ModelMessage[];
}

export async function runAgentLoop(
  env: Env,
  input: LoopInput,
  hooks: LoopHooks,
): Promise<LoopResult> {
  let step = 0;
  let assistantText = "";
  const pendingToolCallIds = new Set<string>();
  const completedToolCallIds = new Set<string>();

  const result = streamText({
    model: gatewayModel(env, input.modelId),
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    ...(input.limits?.maxModelSteps
      ? { stopWhen: stepCountIs(input.limits.maxModelSteps) }
      : {}),
    abortSignal: input.abortSignal,
    onStepFinish: async (stepResult) => {
      step += 1;
      const usage = stepResult.usage;
      await hooks.observe({
        type: "model_step",
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      });
      await hooks.checkpoint({
        nextStepNumber: step + 1,
        messages: [...input.messages, ...stepResult.response.messages],
        partialAssistantText: assistantText,
        completedToolCallIds: [...completedToolCallIds],
        pendingToolCallIds: [...pendingToolCallIds],
      });
      await hooks.emit("assistant.snapshot", { step, text: assistantText });
      await hooks.emit("usage.updated", {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
      });
    },
  });

  await hooks.emit("assistant.started", { attemptId: input.attemptId });
  await hooks.phase("reasoning");

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        // Visible assistant text streaming = responding.
        await hooks.phase("responding");
        assistantText += part.text;
        await hooks.emit("assistant.delta", { channel: "text", text: part.text });
        break;
      case "reasoning-delta":
        await hooks.phase("reasoning");
        await hooks.emit("assistant.delta", {
          channel: "reasoning",
          text: part.text,
        });
        break;
      case "tool-call":
        // The SDK executes tools right after emitting the call parts, so the
        // pending window is brief — but it is a real, distinct phase.
        await hooks.phase("tool_calls_pending");
        pendingToolCallIds.add(part.toolCallId);
        await hooks.observe({
          type: "tool_call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        await hooks.emit("tool.call_created", {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
        });
        await hooks.emit("tool.started", {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
        });
        await hooks.phase("tools_running");
        break;
      case "tool-result":
        pendingToolCallIds.delete(part.toolCallId);
        completedToolCallIds.add(part.toolCallId);
        await hooks.emit("tool.completed", {
          toolCallId: part.toolCallId,
          summary: summarize(part.output),
        });
        break;
      case "tool-error":
        pendingToolCallIds.delete(part.toolCallId);
        await hooks.emit("tool.failed", {
          toolCallId: part.toolCallId,
          error: describeError(part.error),
        });
        break;
      case "error":
        throw part.error instanceof Error
          ? part.error
          : new Error(describeError(part.error));
      default:
        break;
    }
  }

  const [text, response] = await Promise.all([result.text, result.response]);
  await hooks.emit("assistant.completed", { text });
  return { text, messages: [...input.messages, ...response.messages] };
}

function summarize(output: unknown): string {
  const s = typeof output === "string" ? output : JSON.stringify(output);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
