/**
 * Centralized error mechanism.
 * All errors flow through AppError -> error handler -> JSON response.
 * Never throw raw Error from routes; use helpers below.
 */

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "PROVIDER_NOT_CONFIGURED"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_EXPOSED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "DECRYPTION_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly provider?: string;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    opts?: { details?: unknown; provider?: string; cause?: unknown },
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = opts?.details;
    this.provider = opts?.provider;
  }
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "Forbidden"): AppError {
  return new AppError("FORBIDDEN", message, 403);
}

export function notFound(message = "Not found"): AppError {
  return new AppError("NOT_FOUND", message, 404);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError("BAD_REQUEST", message, 400, { details });
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError("VALIDATION_ERROR", message, 400, { details });
}

export function modelNotFound(model: string): AppError {
  return new AppError("MODEL_NOT_FOUND", `Model not found: ${model}`, 404);
}

export function modelNotExposed(model: string): AppError {
  return new AppError("MODEL_NOT_EXPOSED", `Model not exposed by gateway: ${model}`, 403);
}

export function providerNotConfigured(provider: string): AppError {
  return new AppError("PROVIDER_NOT_CONFIGURED", `Provider not configured: ${provider}`, 502, {
    provider,
  });
}

export function providerError(provider: string, message: string, status = 502, cause?: unknown): AppError {
  return new AppError("PROVIDER_ERROR", message, status, { provider, cause });
}

export function rateLimited(message = "Rate limit exceeded"): AppError {
  return new AppError("RATE_LIMITED", message, 429);
}

export function internalError(message = "Internal server error", cause?: unknown): AppError {
  return new AppError("INTERNAL_ERROR", message, 500, { cause });
}

/**
 * Map AppError to OpenAI-compatible error shape.
 * OpenAI spec: { error: { message, type, code } }
 */
export function toOpenAIError(err: AppError): { error: { message: string; type: string; code: string } } {
  return {
    error: {
      message: err.message,
      type: err.code.toLowerCase(),
      code: err.code,
    },
  };
}
