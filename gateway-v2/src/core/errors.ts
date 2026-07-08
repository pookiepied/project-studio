export type GatewayErrorCode =
  | "MODEL_NOT_FOUND"
  | "CAPABILITY_NOT_SUPPORTED"
  | "NO_CREDIT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS: Record<GatewayErrorCode, number> = {
  MODEL_NOT_FOUND: 404,
  CAPABILITY_NOT_SUPPORTED: 400,
  NO_CREDIT: 402,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  VALIDATION_ERROR: 400,
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

export function mapProviderError(error: unknown): GatewayError {
  if (isGatewayError(error)) return error;

  const message = error instanceof Error ? error.message : "The provider request failed.";
  if (/rate limit|429/i.test(message)) {
    return new GatewayError("PROVIDER_RATE_LIMITED", "The provider is rate limiting requests. Please try again soon.");
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return new GatewayError("PROVIDER_TIMEOUT", "The provider did not respond in time.");
  }

  return new GatewayError("PROVIDER_UNAVAILABLE", "The provider could not complete the request.", {
    details: { providerMessage: message }
  });
}

export function toErrorResponse(error: unknown): Response {
  const gatewayError = isGatewayError(error)
    ? error
    : new GatewayError("INTERNAL_ERROR", "The gateway hit an unexpected error.", {
        details: error instanceof Error ? { message: error.message } : undefined
      });

  return Response.json(
    {
      error: {
        code: gatewayError.code,
        message: gatewayError.message,
        details: gatewayError.details
      }
    },
    { status: gatewayError.status }
  );
}
