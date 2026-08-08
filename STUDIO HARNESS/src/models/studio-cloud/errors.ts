import { StudioError } from "../../contracts/errors.js";

/**
 * Failure categories the harness can act on. They are derived from HTTP status
 * and the gateway's own normalized error code only — never from a raw upstream
 * body, which may contain provider detail or echoed request content.
 */
export type StudioGatewayErrorKind =
  | "configuration"
  | "authentication"
  | "authorization"
  | "model"
  | "validation"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "protocol"
  | "aborted"
  | "internal";

/** Gateway error codes the harness recognizes. Anything else is discarded. */
const KNOWN_GATEWAY_CODES = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ROUTE_NOT_FOUND",
  "MODEL_NOT_FOUND",
  "CAPABILITY_NOT_SUPPORTED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "VALIDATION_ERROR",
  "CONFIGURATION_ERROR",
  "PROVIDER_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

const KIND_BY_CODE: Record<string, StudioGatewayErrorKind> = {
  UNAUTHENTICATED: "authentication",
  FORBIDDEN: "authorization",
  ROUTE_NOT_FOUND: "configuration",
  MODEL_NOT_FOUND: "model",
  CAPABILITY_NOT_SUPPORTED: "model",
  PROVIDER_RATE_LIMITED: "rate_limited",
  PROVIDER_TIMEOUT: "timeout",
  VALIDATION_ERROR: "validation",
  CONFIGURATION_ERROR: "configuration",
  PROVIDER_UNAVAILABLE: "unavailable",
  INTERNAL_ERROR: "internal",
};

/** Fixed, caller-safe messages. Upstream text is never interpolated. */
const MESSAGE_BY_KIND: Record<StudioGatewayErrorKind, string> = {
  configuration: "The Studio gateway is not configured to serve this request.",
  authentication: "The Studio gateway rejected the access token.",
  authorization: "The access token is not permitted to perform this request.",
  model: "The Studio gateway does not offer the requested model or capability.",
  validation: "The Studio gateway rejected the request as invalid.",
  rate_limited: "The Studio gateway is rate limiting requests.",
  timeout: "The Studio gateway did not respond in time.",
  unavailable: "The Studio gateway is temporarily unavailable.",
  protocol: "The Studio gateway returned an unreadable response.",
  aborted: "The Studio gateway request was cancelled.",
  internal: "The Studio gateway hit an unexpected error.",
};

/**
 * `status` and `gatewayCode` are kept for local handling and are deliberately
 * absent from the reported shape: an upstream status is transport detail, and
 * the kind already carries everything a caller should branch on.
 */
export class StudioGatewayError extends StudioError {
  readonly domain = "gateway" as const;
  declare readonly kind: StudioGatewayErrorKind;
  readonly status: number | undefined;
  readonly gatewayCode: string | undefined;

  constructor(
    kind: StudioGatewayErrorKind,
    options: { status?: number; gatewayCode?: string; message?: string } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // Retrying is only meaningful where the same request could succeed
      // unchanged. A rejected token, an unknown model, and an invalid request
      // will fail identically every time.
      retryable:
        kind === "rate_limited" || kind === "timeout" || kind === "unavailable",
    });
    this.name = "StudioGatewayError";
    this.status = options.status;
    this.gatewayCode = options.gatewayCode;
  }
}

function kindForStatus(status: number): StudioGatewayErrorKind {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "model";
  if (status === 400 || status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status === 504 || status === 408) return "timeout";
  if (status === 503) return "unavailable";
  if (status >= 500) return "internal";
  return "unavailable";
}

/**
 * Builds a typed error from a failed response. Only the status and a
 * recognized gateway code are used; the response body is not surfaced.
 */
export function studioGatewayErrorForResponse(
  status: number,
  gatewayCode?: string,
): StudioGatewayError {
  const code =
    gatewayCode && KNOWN_GATEWAY_CODES.has(gatewayCode)
      ? gatewayCode
      : undefined;
  const kind = code ? (KIND_BY_CODE[code] ?? kindForStatus(status)) : kindForStatus(status);

  return new StudioGatewayError(kind, {
    status,
    ...(code === undefined ? {} : { gatewayCode: code }),
  });
}

/** Builds a typed error from a terminal `stream.error` event. */
export function studioGatewayErrorForStreamCode(
  gatewayCode?: string,
): StudioGatewayError {
  const code =
    gatewayCode && KNOWN_GATEWAY_CODES.has(gatewayCode)
      ? gatewayCode
      : undefined;
  const kind = code ? (KIND_BY_CODE[code] ?? "internal") : "internal";

  return new StudioGatewayError(kind, {
    ...(code === undefined ? {} : { gatewayCode: code }),
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
