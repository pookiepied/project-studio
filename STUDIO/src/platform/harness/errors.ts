/**
 * Frontend-safe transport errors for the Harness boundary.
 * Raw fetch/Flue errors often contain URLs, tokens, or stack traces — none of
 * which the UI should render. These map to a user-facing string and a code the
 * UI can branch on without leaking material.
 */

export type HarnessErrorCode =
  | "not_connected"
  | "unauthorized"
  | "timeout"
  | "transport"
  | "internal";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HarnessError";
    this.code = code;
  }
}

export function harnessErrorFromUnknown(error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("bearer")) {
    return new HarnessError("unauthorized", "Harness session expired. Restarting…", { cause: error });
  }
  if (lower.includes("aborted") || lower.includes("abort")) {
    return new HarnessError("transport", "Request was cancelled.", { cause: error });
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new HarnessError("timeout", "Harness did not respond in time.", { cause: error });
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return new HarnessError("not_connected", "Harness is not reachable. Is the desktop host running?", { cause: error });
  }
  return new HarnessError("transport", "Harness request failed.", { cause: error });
}
