import { ErrorCodes } from "./codes.js";
import { StudioError } from "./error.js";

export function studioError(code: string, message: string, status = 500): StudioError {
  return new StudioError(code, message, status);
}

export function normalizeProviderStatus(status: number, provider: string): StudioError {
  if (status === 401) return new StudioError(ErrorCodes.AUTH_FAILED, `${provider} authentication failed`, 401);
  if (status === 403) return new StudioError(ErrorCodes.AUTH_FAILED, `${provider} authorization failed`, 403);
  if (status === 429 || status === 432 || status === 433) return new StudioError(ErrorCodes.RATE_LIMITED, `${provider} rate limited`, 429);
  if (status === 402) return new StudioError(ErrorCodes.RATE_LIMITED, `${provider} quota exhausted`, 402);
  if (status === 408 || status === 504) return new StudioError(ErrorCodes.PROVIDER_TIMEOUT, `${provider} timeout`, 504);
  if (status >= 500) return new StudioError(ErrorCodes.PROVIDER_UNAVAILABLE, `${provider} unavailable`, 502);
  if (status === 400 || status === 422) return new StudioError(ErrorCodes.UPSTREAM_ERROR, `${provider} rejected request`, 400);
  return new StudioError(ErrorCodes.UPSTREAM_ERROR, `${provider} error ${status}`, status);
}

export function shouldFallback(err: unknown): boolean {
  if (err instanceof StudioError) {
    return (
      err.code === ErrorCodes.RATE_LIMITED ||
      err.code === ErrorCodes.PROVIDER_TIMEOUT ||
      err.code === ErrorCodes.PROVIDER_UNAVAILABLE ||
      err.code === ErrorCodes.UPSTREAM_ERROR ||
      err.code === ErrorCodes.SEARCH_FAILED ||
      err.code === ErrorCodes.FETCH_FAILED
    );
  }
  // network / abort errors → fallback
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return true;
  if (err instanceof TypeError) return true;
  return false;
}
