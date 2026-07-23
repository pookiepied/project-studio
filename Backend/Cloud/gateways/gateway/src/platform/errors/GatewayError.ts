export type GatewayErrorCode =
  | "ROUTE_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "CAPABILITY_NOT_SUPPORTED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS: Record<GatewayErrorCode, number> = {
  ROUTE_NOT_FOUND: 404,
  MODEL_NOT_FOUND: 404,
  CAPABILITY_NOT_SUPPORTED: 400,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  VALIDATION_ERROR: 400,
  CONFIGURATION_ERROR: 503,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500
};

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: GatewayErrorCode, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
  }
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}
