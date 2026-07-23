import { GatewayError, isGatewayError } from "./GatewayError";

export function mapProviderError(error: unknown): GatewayError {
  if (isGatewayError(error)) return error;

  const message = error instanceof Error ? error.message : "";
  if (/rate limit|429/i.test(message)) {
    return new GatewayError("PROVIDER_RATE_LIMITED", "The provider is rate limiting requests. Please try again soon.");
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return new GatewayError("PROVIDER_TIMEOUT", "The provider did not respond in time.");
  }
  return new GatewayError("PROVIDER_UNAVAILABLE", "The provider could not complete the request.");
}

export function toGatewayError(error: unknown): GatewayError {
  if (isGatewayError(error)) return error;
  if (error instanceof SyntaxError) {
    return new GatewayError("VALIDATION_ERROR", "The request body contains invalid JSON.");
  }
  return new GatewayError("INTERNAL_ERROR", "The gateway hit an unexpected error.");
}
