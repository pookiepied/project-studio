/**
 * Retry backoff for an MCP server that fails to start.
 *
 * A server that fails to start is retried with exponential backoff and full
 * jitter, and a server that fails forever must stop being retried. This file
 * is a pure function from attempt number to a delay, plus a give-up rule — it
 * knows nothing about processes or timers, which is what makes it testable
 * without a process.
 */

// How long to wait before the first retry. One second is quick enough that a
// transient failure — a port not yet free, a file still being written —
// recovers without the user noticing, and slow enough that a tight loop does
// not spin.
export const DEFAULT_BASE_DELAY_MS = 1_000 as const;

// Each attempt waits twice as long as the previous one. Doubling is the
// standard exponential and keeps the retry count small while still bounding
// total wait time.
export const DEFAULT_MULTIPLIER = 2 as const;

// No retry waits longer than thirty seconds. Without a ceiling the delay
// would grow without bound — attempt 20 would otherwise wait twelve days —
// and a user waiting on a server would see no feedback for that long.
export const DEFAULT_MAX_DELAY_MS = 30_000 as const;

// After this many attempts the answer is "give up" rather than a delay.
// Five failures in a row is enough to distinguish a misconfigured command
// from a transient race; retrying forever would hide the configuration error
// and keep a failing process in the retry loop.
export const DEFAULT_MAX_ATTEMPTS = 5 as const;

export interface BackoffOptions {
  readonly baseDelayMs?: number;
  readonly multiplier?: number;
  readonly maxDelayMs?: number;
  readonly maxAttempts?: number;
  /** Random source in [0, 1). Injecting it makes tests deterministic. */
  readonly random?: () => number;
}

export type BackoffResult =
  | { readonly kind: "delay"; readonly delayMs: number }
  | { readonly kind: "give-up" };

/**
 * Returns the delay for the given attempt, or "give-up" when the attempt
 * count has reached the limit.
 *
 * Attempt is zero-indexed — the first retry is attempt 0, the second is
 * attempt 1 — so the ceiling for attempt `n` is
 * `min(base * multiplier^n, maxDelay)`. Full jitter picks a random value in
 * `[0, ceiling)`, so everything that failed together does not retry together.
 */
export function getBackoffDelay(
  attempt: number,
  options: BackoffOptions = {},
): BackoffResult {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const multiplier = options.multiplier ?? DEFAULT_MULTIPLIER;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const random = options.random ?? Math.random;

  if (attempt >= maxAttempts) {
    return { kind: "give-up" };
  }

  // `attempt` is capped by `maxAttempts`, but a caller could pass a large
  // number with a custom `maxAttempts`. `Math.pow` with a large exponent would
  // overflow to Infinity; capping at `maxDelayMs` keeps the result finite and
  // respects the ceiling the caller configured.
  const computed = baseDelayMs * Math.pow(multiplier, attempt);
  const ceiling = Math.min(computed, maxDelayMs);
  // Clamp random to [0, 1) to protect against a caller-supplied source that
  // returns 1 or a value outside the range — the delay must never be negative
  // or NaN and must never exceed the ceiling.
  const r = random();
  const clamped = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0;
  const delayMs = clamped * ceiling;

  // Guard against the one remaining way to produce NaN — a non-finite
  // `baseDelayMs`, `multiplier`, or `maxDelayMs` from a caller-supplied
  // options object. The defaults are finite, but a custom value could be
  // Infinity or NaN and should not propagate.
  if (!Number.isFinite(delayMs)) {
    return { kind: "delay", delayMs: 0 };
  }

  return { kind: "delay", delayMs };
}
