/**
 * Simple error contract for Studio Web MCP — v1 basic version.
 * Per user request: just pass error code + simple human text.
 * No numeric alias, no admin catalog, no fallbackEligible complexity in wire format.
 * Cause/stack never leaves worker, but included in logs if needed.
 */

export class StudioError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "StudioError";
    this.code = code;
    this.status = status;
  }

  toResponse() {
    return { code: this.code, message: this.message };
  }
}

export function isStudioError(v: unknown): v is StudioError {
  return v instanceof StudioError;
}
