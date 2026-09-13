/**
 * The per-class retry budget for Flue's transient model errors.
 *
 * The retry LOOP lives in `@flue/runtime` (patched, see
 * `patches/@flue__runtime@2.0.3.patch`); the budget lives here. That
 * split is the one-authority-per-axis rule from
 * `documentation/architecture/retry.md` applied to the last axis that still
 * carried a private number: the patched bundle cannot import this module
 * (it executes from pnpm's virtual store, and nothing compiles our TypeScript
 * to a path it could reach), so instead of importing, it consults whatever
 * `installTransientModelRetryPolicy` has published on `globalThis`, falling
 * back to its own shipped constants when nothing is installed. This module is
 * therefore the only place in the repository allowed to know what the budgets
 * are; the patch knows only how to ask and what to do with an answer.
 *
 * The contract, which the patch implements defensively:
 *
 *   globalThis.__projectStudioTransientModelRetryPolicy
 *     .decideTransientModelRetry({ attempt, error })
 *       -> { maxRetries: number, delayMs: number }
 *
 * `attempt` is the derived count of consecutive retryable failures (1-based,
 * re-derived from persisted records after a resume), `error` is the failed
 * attempt's provider sentence, and the grant is the budget and wait for THIS
 * failure. A grant is advisory only — the loop, the abort wiring and the wire
 * record stay the bundle's.
 */

import { getBackoffDelay } from "./backoff.js";

/** What the patched runtime asks when a transient model error wants a retry. */
interface TransientModelRetryRequest {
  /** Consecutive retryable failures so far, counting the current one. */
  readonly attempt: number;
  /** The provider's own sentence for the failure, when it carried one. */
  readonly error?: string;
}

/** The budget and wait granted to one failure. */
interface TransientModelRetryGrant {
  /**
   * Retries allowed while failures of this shape keep arriving; the loop gives
   * up once `attempt` exceeds it. Zero means no retry signal at all.
   */
  readonly maxRetries: number;
  /** How long to wait before the next attempt, in milliseconds. */
  readonly delayMs: number;
}

export interface TransientModelRetryPolicy {
  decideTransientModelRetry(
    request: TransientModelRetryRequest,
  ): TransientModelRetryGrant;
}

/**
 * Where the installed policy is published. Quoted verbatim in the patch
 * comment, so an upgrade that reshapes the bundle can still find the seam.
 */
export const TRANSIENT_MODEL_RETRY_POLICY_KEY =
  "__projectStudioTransientModelRetryPolicy";

declare global {
  var __projectStudioTransientModelRetryPolicy:
    | TransientModelRetryPolicy
    | undefined;
}

/**
 * Publishes the policy the patched runtime will consult. Called from the
 * composition root (`src/app.ts`) before any session can run; safe to call
 * again, the latest installation wins.
 */
export function installTransientModelRetryPolicy(
  policy: TransientModelRetryPolicy,
): void {
  globalThis.__projectStudioTransientModelRetryPolicy = policy;
}

/**
 * Removes the published policy. Exists for tests, not for production. Cleared
 * by assignment rather than deletion because a declared global cannot be
 * deleted — and the bundle reads the slot truthily, so undefined is absence.
 */
export function clearInstalledTransientModelRetryPolicy(): void {
  globalThis.__projectStudioTransientModelRetryPolicy = undefined;
}

/**
 * Which kind of transient failure this is, decided from the only thing that
 * survives to the decision point — the sentence.
 *
 * Classification of RETRYABLE-AT-ALL belongs to pi-ai
 * (`isRetryableAssistantError`, delegated by patch hunk one) and is not
 * repeated here: everything this function sees already passed that filter,
 * including the guarantee that quota, billing and monthly-limit exhaustion
 * never arrive (their budget of zero is enforced there, not here). This
 * function only splits the survivors into how patient to be.
 *
 * - `rate-limit`: throttling. The load clears on its own, so waiting works —
 *   the case the architecture document calls worth eight attempts.
 * - `transport`: the connection itself died. Waiting rarely helps; resume is
 *   cheap, so fail fast into something the person can act on.
 * - `generic-transient`: server trouble and everything else pi-ai calls
 *   retryable but no pattern names — deliberately yesterday's budget of three,
 *   because widening a bucket we cannot name needs a reason first.
 */
export type TransientRetryClass =
  | "rate-limit"
  | "transport"
  | "generic-transient";

// Ordered: the most specific signal wins. A sentence carrying both a status
// and transport noise ("connection dropped during 429") reads as throttling,
// because the 429 is the part the provider said on purpose.
const RATE_LIMIT_PATTERN = /\b429\b|rate.?limit|too many requests/i;

// Drawn from the same vocabulary pi-ai matches, minus the rate-limit words:
// sockets, connections, streams cut mid-flight, and the wrappers transports
// throw around them.
const TRANSPORT_PATTERN =
  /connection|refused|reset\b|socket|other side closed|fetch failed|network|terminated|timed.?out|timeout|upstream.?connect|ended without|stream ended before message_stop|http2 request did not get a response|websocket/i;

export function classifyTransientRetryClass(
  error: string | undefined,
): TransientRetryClass {
  const sentence = error ?? "";
  if (RATE_LIMIT_PATTERN.test(sentence)) return "rate-limit";
  if (TRANSPORT_PATTERN.test(sentence)) return "transport";
  return "generic-transient";
}

const RETRY_BUDGETS: Record<TransientRetryClass, number> = {
  "rate-limit": 8,
  transport: 2,
  "generic-transient": 3,
};

// The shipped base, kept so generic-transient waits what it always waited.
const BASE_DELAY_MS = 2_000;
// The shared mechanism's ceiling: eight doublings would otherwise promise a
// four-minute single wait, and no individual wait should outrun a person's
// willingness to watch one.
const MAX_DELAY_MS = 30_000;

// The shipped loop jittered top-heavy — 0.75 to 1.0 of each attempt's
// ceiling. While the doublings are still growing, that keeps every announced
// wait longer than the one before it; full jitter would sometimes announce a
// shorter wait for a later attempt, and a person watching a countdown shrink
// mid-failure reads that as chaos, not statistics. The shared mechanism takes
// any random source, so the distribution ships here as the source instead of
// as a fork of the arithmetic. Past the thirty-second cap the bands overlap —
// the guarantee there is a floor of 22.5 seconds, not monotonicity.
function topHeavyRandom(): number {
  return 0.75 + Math.random() * 0.25;
}

export interface StudioTransientModelRetryPolicyOptions {
  /** Random source in [0, 1). Injection makes tests deterministic. */
  readonly random?: () => number;
}

export function createStudioTransientModelRetryPolicy(
  options: StudioTransientModelRetryPolicyOptions = {},
): TransientModelRetryPolicy {
  return {
    decideTransientModelRetry: (
      request: TransientModelRetryRequest,
    ): TransientModelRetryGrant => {
      const retryClass = classifyTransientRetryClass(request.error);
      const maxRetries = RETRY_BUDGETS[retryClass];
      // The bundle counts attempts from one; the shared mechanism from zero.
      // Under that mapping give-up arrives exactly when `attempt` exceeds the
      // budget — the same boundary the bundle enforced when it had one number.
      const delay = getBackoffDelay(request.attempt - 1, {
        baseDelayMs: BASE_DELAY_MS,
        maxDelayMs: MAX_DELAY_MS,
        maxAttempts: maxRetries,
        random: options.random ?? topHeavyRandom,
      });
      return {
        maxRetries,
        delayMs: delay.kind === "delay" ? delay.delayMs : 0,
      };
    },
  };
}
