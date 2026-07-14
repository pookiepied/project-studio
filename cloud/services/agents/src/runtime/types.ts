/**
 * Runtime types for the agents worker.
 *
 * AgentRunConfig  — passed by the main agent (or the run handler) when spawning a sub-agent.
 * AgentState      — persisted in the DO's SQLite-backed state across hibernation.
 * LLM*            — OpenAI-compatible message/tool shapes used in the ReAct loop.
 * AgentLoopResult — returned by runAgentLoop() once the loop exits.
 */

// ---------------------------------------------------------------------------
// Run configuration — supplied at spawn time
// ---------------------------------------------------------------------------

export interface AgentRunConfig {
  /** Unique identifier for this run (used as the DO name via idFromName). */
  runId:           string;
  /** Authenticated user this run belongs to. Passed to hub for Composio + tracking. */
  userId:          string;
  /** Resolved primary LLM, in "provider:modelId" format (tier already resolved). */
  model:           string;
  /** Resolved fallback LLM, tried once if the primary errors. */
  fallbackModel?:  string;
  /** Full system prompt injected at position 0 of every LLM call. */
  systemPrompt:    string;
  /** Initial task messages. Typically a single user message describing the work. */
  messages:        LLMMessage[];
  /** Conversation the sub-agent belongs to — used as the blackboard scope. */
  conversationId?: string;
  /** Stop after this many ReAct iterations. Undefined = unbounded. */
  maxIterations?:  number;
  /** Stop when cumulative token usage reaches this value. Undefined = unbounded. */
  tokenBudget?:    number;
}

// ---------------------------------------------------------------------------
// Agent lifecycle status
// ---------------------------------------------------------------------------

export type AgentStatus = "idle" | "running" | "done" | "failed" | "cancelled";

// ---------------------------------------------------------------------------
// Durable Object state — persisted across hibernation
// ---------------------------------------------------------------------------

export interface AgentState {
  status:      AgentStatus;
  runId:       string;
  userId:      string;
  config:      AgentRunConfig;
  /** Number of completed ReAct iterations (tool-call rounds). */
  iteration:   number;
  /** Cumulative tokens consumed so far. */
  totalTokens: number;
  /** Heartbeat — updated before each LLM step. Lets a watcher detect a dead run. */
  lastActiveAt?: number;
  /**
   * Monotonic run token, bumped on every start/resume. The active loop only
   * commits state while its captured generation still matches — so a resumed
   * run cleanly supersedes a zombie loop instead of both corrupting state.
   */
  generation?: number;
  /** How many times this run has been auto-resumed after a stall. */
  resumeCount?: number;
  /** Full message history built up during the loop (system + task + turns). */
  messages:    LLMMessage[];
  /** Final assistant text when status = "done". */
  result?:     string;
  /** Error message when status = "failed". */
  error?:      string;
  startedAt?:  number;
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible LLM message types
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role:          "system" | "user" | "assistant" | "tool";
  content:       string | null;
  tool_calls?:   LLMToolCall[];
  tool_call_id?: string;
  name?:         string;
}

export interface LLMToolCall {
  id:       string;
  type:     "function";
  function: {
    name:      string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type:     "function";
  function: {
    name:        string;
    description: string;
    parameters:  unknown;
  };
}

export interface LLMUsage {
  prompt_tokens?:     number;
  completion_tokens?: number;
  total_tokens?:      number;
}

export interface LLMResponse {
  message: LLMMessage;
  usage?:  LLMUsage;
}

// ---------------------------------------------------------------------------
// Loop result
// ---------------------------------------------------------------------------

export type LoopStopReason = "done" | "max_iterations" | "token_budget" | "cancelled" | "error";

export interface AgentLoopResult {
  finalMessage: string;
  iterations:   number;
  totalTokens:  number;
  stopReason:   LoopStopReason;
}
