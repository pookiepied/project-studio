/** Stable failure classes emitted by every Studio runtime. */
export type RuntimeErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "provider_transient"
  | "provider_terminal"
  | "tool_transient"
  | "tool_terminal"
  | "timeout"
  | "cancelled"
  | "runtime_restart"
  | "protocol_error";

export interface NormalizedRuntimeError {
  category: RuntimeErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
}
