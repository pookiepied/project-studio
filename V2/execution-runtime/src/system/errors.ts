/** Centralized error taxonomy for the execution runtime. */

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
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}
