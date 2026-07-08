/**
 * Core type definitions for the provider adapter system.
 *
 * Every piece of the pipeline — adapters, streaming handlers, tracking — imports
 * from here. Keeping types in a dedicated file prevents circular imports and makes
 * it easy for future contributors to find the contract without reading implementation code.
 */

import type { AgentMessage, ToolCall } from "../types";

// Re-export so callers have one import for everything agent-related
export type { AgentMessage, ToolCall };

// ---------------------------------------------------------------------------
// Usage capture — populated by each provider's SSE/response parser
// ---------------------------------------------------------------------------

/**
 * Token and cost data captured from a single API response.
 * Populated by captureUsage callbacks; stored in CapturedUsage|null by callers.
 *
 * Field notes:
 *   cache_read_input_tokens     — Anthropic native field (prompt cache hits)
 *   cache_creation_input_tokens — Anthropic native field (prompt cache writes)
 *   prompt_tokens_details.cached_tokens — OpenAI/Groq style; normalised
 *                                          to cache_read_input_tokens by parsers
 *   cost                        — USD cost returned directly by provider (OpenRouter only)
 *   id                          — Provider generation/request ID for correlation
 */
export interface CapturedUsage {
  prompt_tokens?:              number;
  completion_tokens?:          number;
  total_tokens?:               number;
  cache_read_input_tokens?:    number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?:           number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  cost?: number;   // only populated by OpenRouter (returned in API response)
  id?:  string;
}

// ---------------------------------------------------------------------------
// Completion parameters — passed to every adapter method
// ---------------------------------------------------------------------------

export interface CompletionParams {
  model:        string;
  messages:     AgentMessage[];
  temperature:  number;
  maxTokens?:   number;
  topP?:        number;
  /** AbortSignal from the inbound request — cancels the upstream AI SDK call when the client disconnects. */
  abortSignal?: AbortSignal;
  /** Tool definitions to advertise to the model (agent loop only). */
  tools?:       unknown[];
  /**
   * "auto"     — model decides whether to call a tool (default when tools present)
   * "none"     — force a plain text response even when tools are registered
   * "required" — model MUST call at least one tool
   * { type: "function", function: { name } } — force a specific tool
   */
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  /** Called once at stream/response end with token and cost data. */
  captureUsage?: (usage: CapturedUsage) => void;
  /**
   * Extended thinking / reasoning budget in tokens.
   * Passed as providerOptions to providers that support it:
   *   Anthropic → thinking.budgetTokens
   *   Google    → thinkingConfig.thinkingBudget
   * Set to 0 to explicitly disable thinking on models that default-enable it.
   */
  reasoningBudget?: number;
}

// ---------------------------------------------------------------------------
// Stream events — discriminated union yielded by streamFull()
// ---------------------------------------------------------------------------

/**
 * Events yielded by streamFull() during a single API call:
 *   content    — a clean text token chunk; pipe directly to the SSE client
 *   tool_calls — fully assembled tool calls collected across delta chunks
 *   usage      — token/cost metadata; emitted once at stream end
 */
export type StreamEvent =
  | { type: "content";    chunk: string }
  | { type: "reasoning";  chunk: string }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage";      data: CapturedUsage };

// ---------------------------------------------------------------------------
// Provider adapter contract
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  /**
   * Non-streaming completion — used by the agent node loop.
   * Returns a single assistant message (may include tool_calls).
   */
  complete(params: CompletionParams): Promise<AgentMessage>;

  /**
   * Streaming completion — used for the final user-visible answer.
   * Yields clean, tokenizer-artefact-stripped content string chunks.
   * Tools are passed with tool_choice:"none" so the model answers directly.
   */
  stream(params: CompletionParams): AsyncGenerator<string, void, unknown>;

  /**
   * Streaming completion with tool-call detection.
   * Yields content chunks in real time and, at stream end, a tool_calls event
   * if the model elected to call tools instead of (or alongside) answering.
   * Used for Phase 1 so the client sees tokens immediately.
   */
  streamFull(params: CompletionParams): AsyncGenerator<StreamEvent, void, unknown>;

  /** Attach a telemetry callback for provider API errors. Returns `this` for chaining. */
  withErrorReporter(fn: (httpStatus: number, message: string, model: string) => void): this;
}
