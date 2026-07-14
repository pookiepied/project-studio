import { json } from "../http/request";

export type ConnectorErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "not_configured"
  | "provider_error"
  | "provider_auth_expired"
  | "forbidden"
  | "conflict"
  | "internal_error";

const STATUS_BY_CODE: Record<ConnectorErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  not_configured: 503,
  provider_error: 502,
  provider_auth_expired: 401,
  internal_error: 500,
};

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly status: number = STATUS_BY_CODE[code],
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  const err = error instanceof ConnectorError
    ? error
    : new ConnectorError("internal_error", error instanceof Error ? error.message : String(error));

  return json({
    error: {
      code: err.code,
      message: err.message,
      status: err.status,
      retryable: err.retryable,
      details: err.details ?? {},
    },
  }, err.status);
}

export function connectorError(
  code: ConnectorErrorCode,
  message: string,
  details?: Record<string, unknown>,
  status?: number,
  retryable = false,
): ConnectorError {
  return new ConnectorError(code, message, details, status, retryable);
}
