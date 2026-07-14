/**
 * New base adapter — uses AI SDK v6 generateText / streamText internally.
 * Implements the existing ProviderAdapter interface so the pipeline (phase1/phase2/llm)
 * requires zero changes.
 *
 * AI SDK v6 shapes (verified against node_modules type definitions):
 *   maxTokens               → maxOutputTokens
 *   promptTokens            → inputTokens
 *   completionTokens        → outputTokens
 *   fullStream text-delta   → chunk.textDelta (fallback: chunk.text)
 *   tool-call / ToolCallPart → .input  (not .args)
 *   ToolResultPart.output   → { type:'text'|'json', value } (not raw value)
 *   finish event            → totalUsage (no providerMetadata — only finish-step has it)
 *   cache tokens            → usage.inputTokenDetails.cacheReadTokens / cacheWriteTokens
 *   reasoning tokens        → usage.outputTokenDetails.reasoningTokens
 */

import {
  generateText,
  streamText,
  APICallError,
  type LanguageModel,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai";
import type { JSONObject } from "@ai-sdk/provider";

import type { AgentMessage } from "../types";
import type { CapturedUsage, CompletionParams, StreamEvent, ProviderAdapter } from "../types";

import { ThinkStripper, cleanModelTokens, cleanStreamChunk } from "../utils";
import { toCoreMsgs }                                         from "./shared/messages";
import { toAiSdkTools, toToolCall }                           from "./shared/tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureUsageFromResult(u: LanguageModelUsage): CapturedUsage {
  const usage: CapturedUsage = {
    prompt_tokens:     u.inputTokens,
    completion_tokens: u.outputTokens,
    total_tokens:      u.totalTokens,
  };
  if (u.inputTokenDetails?.cacheReadTokens) {
    usage.cache_read_input_tokens = u.inputTokenDetails.cacheReadTokens;
  }
  if (u.inputTokenDetails?.cacheWriteTokens) {
    usage.cache_creation_input_tokens = u.inputTokenDetails.cacheWriteTokens;
  }
  const reasoningTokens = (u as any).outputTokenDetails?.reasoningTokens;
  if (reasoningTokens) usage.reasoning_tokens = reasoningTokens;
  return usage;
}

/**
 * Converts OpenAI-style toolChoice to AI SDK v6 format.
 * OpenAI: { type:"function", function:{ name } }
 * SDK v6: { type:"tool", toolName }
 */
function toSdkToolChoice(
  tc: CompletionParams["toolChoice"],
): "auto" | "none" | "required" | { type: "tool"; toolName: string } {
  if (!tc || tc === "auto")     return "auto";
  if (tc === "none")            return "none";
  if (tc === "required")        return "required";
  if (typeof tc === "object" && tc.type === "function") {
    return { type: "tool", toolName: tc.function.name };
  }
  return "auto";
}

// ---------------------------------------------------------------------------
// Base adapter
// ---------------------------------------------------------------------------

export abstract class BaseAdapter implements ProviderAdapter {
  protected abstract readonly providerName: string;

  protected abstract getModel(modelId: string): LanguageModel;

  private _onProviderError?: (httpStatus: number, message: string, model: string) => void;

  /** Attach telemetry without this class needing to know about tracking. */
  withErrorReporter(fn: (httpStatus: number, message: string, model: string) => void): this {
    this._onProviderError = fn;
    return this;
  }

  protected emitProviderError(httpStatus: number, message: string, model: string): void {
    this._onProviderError?.(httpStatus, message, model);
  }

  // ── complete ──────────────────────────────────────────────────────────────

  async complete(params: CompletionParams): Promise<AgentMessage> {
    const tools = params.tools?.length ? toAiSdkTools(params.tools) : undefined;

    try {
      const result = await generateText({
        model:           this.getModel(params.model),
        messages:        toCoreMsgs(params.messages),
        tools,
        toolChoice:      tools ? toSdkToolChoice(params.toolChoice) : undefined,
        temperature:     params.temperature,
        maxOutputTokens: params.maxTokens,
        topP:            params.topP,
        abortSignal:     params.abortSignal,
        maxRetries:      0,
        ...(params.reasoningBudget != null
          ? { providerOptions: this.buildThinkingOptions(params.reasoningBudget) }
          : {}),
      });

      if (params.captureUsage) {
        const usage = captureUsageFromResult(result.usage);
        // Capture provider response/generation ID (populated by OpenRouter etc.)
        const responseId = (result as any).response?.id as string | undefined;
        if (responseId) usage.id = responseId;
        params.captureUsage(usage);
      }

      const toolCalls = (result as any).toolCalls as any[] | undefined;
      return {
        role:    "assistant",
        content: cleanModelTokens(result.text || null),
        ...(toolCalls?.length ? { tool_calls: toolCalls.map(toToolCall) } : {}),
      };

    } catch (err) {
      if (err instanceof APICallError) {
        this.emitProviderError(err.statusCode ?? 0, err.message, params.model);
        if (err.statusCode === 402 && params.tools?.length) {
          return this.complete({ ...params, tools: undefined, toolChoice: undefined });
        }
        throw new Error(`[${this.providerName}] HTTP ${err.statusCode}: ${err.message.slice(0, 400)}`);
      }
      throw err;
    }
  }

  // ── stream ────────────────────────────────────────────────────────────────

  async *stream(params: CompletionParams): AsyncGenerator<string, void, unknown> {
    const tools    = params.tools?.length ? toAiSdkTools(params.tools) : undefined;
    const stripper = new ThinkStripper();

    try {
      const result = streamText({
        model:           this.getModel(params.model),
        messages:        toCoreMsgs(params.messages),
        tools,
        toolChoice:      tools ? "none" : undefined,
        temperature:     params.temperature,
        maxOutputTokens: params.maxTokens,
        topP:            params.topP,
        abortSignal:     params.abortSignal,
        maxRetries:      0,
      });

      for await (const chunk of result.textStream) {
        const clean = stripper.strip(cleanStreamChunk(chunk));
        if (clean) yield clean;
      }

      if (params.captureUsage) {
        const u = await result.usage;
        params.captureUsage(captureUsageFromResult(u));
      }
    } catch (err) {
      if (err instanceof APICallError) {
        this.emitProviderError(err.statusCode ?? 0, err.message, params.model);
        throw new Error(`[${this.providerName}] HTTP ${err.statusCode}: ${err.message.slice(0, 400)}`);
      }
      throw err;
    }
  }

  // ── streamFull ────────────────────────────────────────────────────────────

  async *streamFull(
    params: CompletionParams,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const tools        = params.tools?.length ? toAiSdkTools(params.tools) : undefined;
    const stripper     = new ThinkStripper();
    const accumCalls: ReturnType<typeof toToolCall>[] = [];
    // finish-step carries providerMetadata and response.id (finish event does not)
    let lastStepMeta:       ProviderMetadata | undefined;
    let lastStepResponseId: string | undefined;

    try {
      const result = streamText({
        model:           this.getModel(params.model),
        messages:        toCoreMsgs(params.messages),
        tools,
        toolChoice:      tools ? toSdkToolChoice(params.toolChoice) : undefined,
        temperature:     params.temperature,
        maxOutputTokens: params.maxTokens,
        topP:            params.topP,
        abortSignal:     params.abortSignal,
        maxRetries:      0,
        ...(params.reasoningBudget != null
          ? { providerOptions: this.buildThinkingOptions(params.reasoningBudget) }
          : {}),
      });

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case "text-delta": {
            // Both textDelta (AI SDK v6 fullStream) and text (legacy) are handled
            const raw   = (chunk as any).textDelta ?? (chunk as any).text ?? "";
            const clean = stripper.strip(cleanStreamChunk(raw));
            if (clean) yield { type: "content", chunk: clean };
            break;
          }

          case "reasoning-delta": {
            // Extended thinking output (Anthropic, Gemini thinking models).
            const reasonText = (chunk as any).textDelta ?? (chunk as any).text ?? (chunk as any).delta ?? "";
            if (reasonText) yield { type: "reasoning", chunk: reasonText };
            break;
          }

          case "tool-call": {
            accumCalls.push(toToolCall(chunk as any));
            break;
          }

          case "finish-step": {
            // Capture providerMetadata and response ID here — `finish` event does not carry them
            lastStepMeta       = (chunk as any).providerMetadata as ProviderMetadata | undefined;
            lastStepResponseId = (chunk as any).response?.id as string | undefined;
            break;
          }

          case "finish": {
            const u = (chunk as any).totalUsage as LanguageModelUsage | undefined;
            if (u) {
              const usage = captureUsageFromResult(u);
              // OpenRouter cost + generation ID live in providerMetadata from finish-step
              const orCost = (lastStepMeta as any)?.openrouter?.usage?.cost;
              if (orCost) usage.cost = orCost;
              if (lastStepResponseId) usage.id = lastStepResponseId;

              yield { type: "usage", data: usage };
              params.captureUsage?.(usage);
            }
            break;
          }

          case "error":
            throw (chunk as any).error ?? new Error(`[${this.providerName}] stream error`);
        }
      }

      if (accumCalls.length) {
        yield { type: "tool_calls", calls: accumCalls };
      }

    } catch (err) {
      if (err instanceof APICallError) {
        this.emitProviderError(err.statusCode ?? 0, err.message, params.model);
        throw new Error(`[${this.providerName}] HTTP ${err.statusCode}: ${err.message.slice(0, 400)}`);
      }
      throw err;
    }
  }

  // ── Reasoning / extended thinking ─────────────────────────────────────────

  /**
   * Builds provider-specific options for extended thinking / reasoning budget.
   * Anthropic and Google use different option shapes; all others ignore unknown options.
   */
  protected buildThinkingOptions(budgetTokens: number): Record<string, JSONObject> {
    switch (this.providerName) {
      case "anthropic":
        return budgetTokens > 0
          ? { anthropic: { thinking: { type: "enabled", budgetTokens } as JSONObject } }
          : { anthropic: { thinking: { type: "disabled" } as JSONObject } };

      case "google":
        return budgetTokens > 0
          ? { google: { thinkingConfig: { thinkingBudget: budgetTokens, includeThoughts: true } as JSONObject } }
          : { google: { thinkingConfig: { thinkingBudget: 0 } as JSONObject } };

      case "openrouter":
        // OpenRouter supports { reasoning: { max_tokens: N } } for Claude and
        // other thinking-capable models routed through its API.
        return budgetTokens > 0
          ? { openrouter: { reasoning: { max_tokens: budgetTokens } as JSONObject } }
          : {};

      default:
        return {};
    }
  }
}
