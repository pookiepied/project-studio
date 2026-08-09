import { isWorthRetryingElsewhere, RetrievalError } from "./errors.js";
import type { RetrievalProvider } from "./types.js";

/**
 * Two slots, and the rule for moving between them.
 *
 * ADR 0023 §2: a default and one fallback. Never a pool. Connecting five
 * services does not mean trying five — every extra attempt spends another
 * account's quota, adds another timeout to the user's wait, and turns one clear
 * failure into a vague one.
 *
 * The fallback may be absent. One provider and a good error is a valid setup,
 * and it is what someone with a single key has.
 */

export interface ProviderSlots<T extends RetrievalProvider> {
  readonly primary: T;
  readonly fallback: T | undefined;
}

export interface SlotOutcome<R> {
  readonly value: R;
  /** Which provider actually answered. Always reported, never inferred. */
  readonly provider: string;
  /** Why the primary was passed over, when it was. */
  readonly fellBackFrom: { provider: string; reason: string } | undefined;
}

/**
 * Runs the primary, and the fallback only when the failure is one a different
 * service could survive.
 *
 * `allowFallbackOnBlocked` is the one caller-decided case. A search provider
 * being refused means nothing that a second search provider fixes. A *site*
 * refusing a plain client is exactly what a different reader gets past. Both
 * are `blocked`, and only the caller knows which situation it is in.
 */
export async function runWithFallback<T extends RetrievalProvider, R>(
  slots: ProviderSlots<T>,
  work: (provider: T) => Promise<R>,
  options: { allowFallbackOnBlocked?: boolean } = {},
): Promise<SlotOutcome<R>> {
  try {
    return {
      value: await work(slots.primary),
      provider: slots.primary.id,
      fellBackFrom: undefined,
    };
  } catch (error) {
    const fallback = slots.fallback;
    if (!fallback || !shouldTryFallback(error, options.allowFallbackOnBlocked === true)) {
      throw error;
    }

    const reason = error instanceof RetrievalError ? error.message : "it failed";

    try {
      return {
        value: await work(fallback),
        provider: fallback.id,
        fellBackFrom: { provider: slots.primary.id, reason },
      };
    } catch (fallbackError) {
      // Both failed. The second error is the one thrown, because it is the last
      // thing that happened, but the caller is told about both — a model that
      // hears only "firecrawl was blocked" will retry a URL that Jina also
      // could not read.
      throw new RetrievalError(
        fallbackError instanceof RetrievalError ? fallbackError.kind : "internal",
        {
          provider: fallback.id,
          message:
            `${slots.primary.name} failed (${reason}), and ${fallback.name} failed too` +
            (fallbackError instanceof RetrievalError
              ? ` (${fallbackError.message})`
              : "") +
            ".",
          cause: fallbackError,
        },
      );
    }
  }
}

/**
 * Whether a second provider could plausibly answer differently.
 *
 * Anything that is not a `RetrievalError` — a cancellation, a bug in our own
 * code — is not a provider failure and must never spend a second account's
 * quota.
 */
function shouldTryFallback(error: unknown, allowBlocked: boolean): boolean {
  if (!(error instanceof RetrievalError)) return false;
  if (error.kind === "blocked") return allowBlocked;
  return isWorthRetryingElsewhere(error.kind);
}
