import type { ToolExecutionError } from "./contracts";

export class ToolExecutionException extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { retryable?: boolean; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "ToolExecutionException";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

export function toToolError(error: unknown): ToolExecutionError {
  if (error instanceof ToolExecutionException) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    };
  }
  if (error instanceof Error) return { code: "internal_error", message: error.message, retryable: false };
  return { code: "internal_error", message: String(error), retryable: false };
}

export function invalidRequest(message: string, details?: unknown): ToolExecutionException {
  return new ToolExecutionException("invalid_request", message, { status: 400, details });
}

export function forbidden(message: string): ToolExecutionException {
  return new ToolExecutionException("forbidden", message, { status: 403 });
}

export function notImplemented(message: string, details?: unknown): ToolExecutionException {
  return new ToolExecutionException("not_implemented", message, { status: 501, details });
}

export function upstreamError(message: string, details?: unknown, retryable = true): ToolExecutionException {
  return new ToolExecutionException("upstream_error", message, { status: 502, retryable, details });
}
