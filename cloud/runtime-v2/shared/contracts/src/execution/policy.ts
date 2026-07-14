/**
 * Tool policy, idempotency, and approval contracts (RUNTIME-CHECKLIST.md
 * §7–§9). The runtime NEVER decides permissions — the frontend/parent owns
 * that. The runtime is a permission listener: it persists the request, holds
 * the run at the boundary, broadcasts `approval.required`, accepts exactly
 * one resolution, and enforces it.
 */

/** Execution metadata every registered tool carries. */
export interface ToolPolicy {
  locality: "cloud" | "local" | "either";
  effect: "none" | "read" | "write" | "destructive";
  /** Calls sharing a key are serialized; independent keys may run parallel. */
  concurrencyKey?: string;
  idempotent: boolean;
  requiresApproval: boolean;
  retryable: boolean;
  timeoutMs: number;
  maxResultBytes: number;
  permissionScopes: string[];
}

/** Sensible default: a read-only, retryable cloud tool. */
export const DEFAULT_TOOL_POLICY: ToolPolicy = {
  locality: "cloud",
  effect: "read",
  idempotent: true,
  requiresApproval: false,
  retryable: true,
  timeoutMs: 60_000,
  maxResultBytes: 512_000,
  permissionScopes: [],
};

/**
 * Idempotency record for a side-effecting operation. Reserved atomically
 * BEFORE execution; a retried/recovered run finds the record and returns the
 * previous result instead of repeating the side effect.
 */
export interface OperationRecord {
  /** `${runId}:${toolCallId}` */
  operationKey: string;
  runId: string;
  toolCallId: string;
  status: "reserved" | "executing" | "completed" | "failed";
  /** JSON-serialized result, present when status = completed. */
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  summarizedAction: string;
  normalizedInput: unknown;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied" | "expired";
  /** Who resolved it (frontend-supplied identity), once resolved. */
  resolvedBy?: string;
  expiresAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * Optional run safety policy. Undefined means unlimited.
 *
 * These are not product-plan limits and not arbitrary chat caps. They are
 * runtime guardrails a caller may opt into for a specific mode, agent, or
 * task. The default execution runtime policy is open-ended: keep running while
 * the system is available and the run is making progress.
 */
export interface ExecutionLimits {
  maxModelSteps?: number;
  maxToolCalls?: number;
  maxRepeatedToolCalls?: number;
  maxWallClockMs?: number;
  maxConsecutiveErrors?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxModelCostUsd?: number;
  maxToolCostUsd?: number;
}

export interface ExecutionUsage {
  modelSteps: number;
  toolCalls: number;
  consecutiveErrors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelCostUsd?: number;
  toolCostUsd?: number;
  startedAt: string;
}

export type ExecutionStopReason =
  | "limit_model_steps"
  | "limit_tool_calls"
  | "limit_repeated_tool_calls"
  | "limit_wall_clock"
  | "limit_consecutive_errors"
  | "limit_input_tokens"
  | "limit_output_tokens"
  | "limit_total_tokens"
  | "limit_model_cost"
  | "limit_tool_cost";

/** Default philosophy: no hard cap unless a runtime config supplies one. */
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {};
