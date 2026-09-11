import { StudioError } from "../../contracts/errors.js";

/**
 * How a retrieval provider failed.
 *
 * Seven kinds, chosen so the *caller* can act without reading a vendor status
 * code. Two questions are answered by the kind alone: may the fallback provider
 * be tried, and is this the user's problem or ours.
 *
 * Provisional by decision, not by neglect. ADR 0023 §4 and `C-13`: the final
 * shape wants a settings screen to design against, and there is not one yet.
 * Every vendor mapping lives in one file per provider, so changing this later is
 * an edit here and in five adapters, not a sweep.
 */
export type RetrievalErrorKind =
  /** No key, wrong key, or a revoked key. The user must fix it. */
  | "unauthorized"
  /** Too many requests just now. Temporary, and per account. */
  | "rate_limited"
  /** The plan is used up. Lasting, and per account. */
  | "quota_exhausted"
  /** The service is down, unreachable, or answering with nonsense. */
  | "unavailable"
  /** The service did not answer in time. */
  | "timeout"
  /** We sent something the service rejected. Our bug, not the user's. */
  | "invalid_request"
  /** The destination refused us: a paywall, a bot check, a robots rule. */
  | "blocked"
  /** The provider failed in a way we have no word for yet. */
  | "internal";

const MESSAGE_BY_KIND: Record<RetrievalErrorKind, string> = {
  unauthorized: "The provider rejected the API key. Check it in settings.",
  rate_limited: "The provider is rate limiting requests. Try again shortly.",
  quota_exhausted: "The provider account has no quota left.",
  unavailable: "The provider could not be reached.",
  timeout: "The provider did not answer in time.",
  invalid_request: "The provider rejected the request.",
  blocked: "The site refused the request.",
  internal: "The provider failed unexpectedly.",
};

/**
 * Whether trying the fallback provider could plausibly produce a different
 * answer.
 *
 * This is the whole reason the kinds exist, so it lives next to them rather
 * than in the runner. A bad key fails identically at every provider, and a
 * malformed request is ours — falling through on either one spends a second
 * account's quota to hide a problem the user needs to see.
 *
 * `blocked` is the interesting one and is decided by the caller, not here: a
 * search provider being refused means nothing a second search provider fixes,
 * while a *site* refusing a plain client is exactly what a different reader
 * service gets past.
 */
export function isWorthRetryingElsewhere(kind: RetrievalErrorKind): boolean {
  return (
    kind === "unavailable" ||
    kind === "timeout" ||
    kind === "rate_limited" ||
    kind === "quota_exhausted"
  );
}

export class RetrievalError extends StudioError {
  readonly domain = "retrieval" as const;
  declare readonly kind: RetrievalErrorKind;
  /** Which provider produced this, for the message the user reads. */
  readonly provider: string | undefined;

  constructor(
    kind: RetrievalErrorKind,
    options: { message?: string; provider?: string; cause?: unknown } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // A key stays wrong and a quota stays empty. Being down and being slow do
      // not, and neither does a rate limit.
      retryable:
        kind === "unavailable" || kind === "timeout" || kind === "rate_limited",
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "RetrievalError";
    this.provider = options.provider;
  }
}

/**
 * Maps an HTTP status onto a kind.
 *
 * Shared because every provider here speaks HTTP and most of them use the
 * conventional statuses. An adapter overrides it where its own service does
 * something else — that is the adapter's job, and the reason each one owns its
 * mapping.
 */
export function retrievalKindForStatus(status: number): RetrievalErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500) return "unavailable";
  return "internal";
}
