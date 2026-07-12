/** Centralized error taxonomy shared by every runtime built on the engine. */
import type { NormalizedRuntimeError, RuntimeErrorCategory } from "@studio/v2-contracts";

export type ExecutionErrorCode =
  | "run_not_found"
  | "run_already_active"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "stale_command"
  | "illegal_transition"
  | "approval_not_found"
  | "approval_already_resolved"
  | "provider_failure"
  | "context_unavailable"
  | "tool_failure"
  | "local_unavailable"
  | "limit_exceeded"
  | "repeated_tool_cycle"
  | "execution_limit_reached"
  | "cancelled";

export class ExecutionError extends Error {
  constructor(
    readonly code: ExecutionErrorCode,
    message: string,
    readonly retryable = false,
    readonly category: RuntimeErrorCategory = categoryForCode(code),
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}

export function normalizeRuntimeError(error: unknown): NormalizedRuntimeError {
  if (error instanceof ExecutionError) {
    return { category: error.category, code: error.code, message: error.message, retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("cancel")) return normalized("cancelled", "cancelled", message, false);
  if (lower.includes("timeout") || lower.includes("timed out")) return normalized("timeout", "timeout", message, false);
  if (/\b429\b|rate.?limit/.test(lower)) return normalized("rate_limit", "rate_limit", message, true);
  if (/\b401\b|unauthenticated|invalid token/.test(lower)) return normalized("authentication", "authentication", message, false);
  if (/\b403\b|permission|forbidden|denied/.test(lower)) return normalized("authorization", "authorization", message, false);
  if (/\b(408|500|502|503|504)\b|network|connection reset|temporar/.test(lower)) return normalized("provider_transient", "provider_transient", message, true);
  return normalized("provider_terminal", "provider_terminal", message, false);
}

function normalized(category: RuntimeErrorCategory, code: string, message: string, retryable: boolean): NormalizedRuntimeError {
  return { category, code, message, retryable };
}

function categoryForCode(code: ExecutionErrorCode): RuntimeErrorCategory {
  if (code === "unauthorized") return "authentication";
  if (code === "forbidden" || code.startsWith("approval_")) return "authorization";
  if (code === "cancelled") return "cancelled";
  if (code === "provider_failure" || code === "context_unavailable") return "provider_transient";
  if (code === "tool_failure" || code === "local_unavailable") return "tool_terminal";
  if (code === "invalid_request" || code === "limit_exceeded" || code === "execution_limit_reached" || code === "repeated_tool_cycle") return "validation";
  return "protocol_error";
}
