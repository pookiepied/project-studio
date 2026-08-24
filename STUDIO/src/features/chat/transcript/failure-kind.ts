/**
 * What a failed turn's sentence tells the person reading it.
 *
 * A billing failure and a rate limit are not the same sentence and do not
 * have the same fix, so the remedy line under a failure is chosen by
 * classifying the settlement's own words — wire facts only, never the other
 * way around: nothing here feeds back into requests, projections, or retry
 * behaviour. That machinery lives in the harness; this module exists so the
 * surface Task 26 built says something worth acting on.
 *
 * Three kinds, and the honesty rules between them:
 *
 * - **quota** — exhaustion of a plan, budget, or billing limit. This will
 *   not resolve by waiting; it points at the provider account. Detected
 *   FIRST, because providers report it as HTTP 429 too: a sentence can match
 *   both lists at once, and "check your account" must not be drowned out by
 *   "try again later".
 * - **rate-limited** — deliberately narrower than the harness's full
 *   transient set. The remedy claims a retry already happened, which is true
 *   only of sentences the harness both recognizes and retries; claiming it
 *   for every transient-looking wording would manufacture reassurance. The
 *   throttle family is where "wait, then send again" is specifically the
 *   right advice, so it is the only family that gets said.
 * - **unclassified** — everything else, including an empty or absent
 *   sentence. An unrecognized error is not a rate limit; inventing a category
 *   here is the same defect class as inventing a completion. The provider's
 *   own words render beside the failure, and they say enough.
 *
 * The quota wordings mirror the non-retryable list in
 * `@earendil-works/pi-ai` (`dist/utils/retry.js`) — the same judgement the
 * patched harness applies before deciding to retry. Mirrored rather than
 * imported so no model SDK enters webview code; the asymmetry if the lists
 * drift is safe: a stale mirror under-states (an exhausted account shows an
 * unclassified sentence), it never fabricates advice.
 */

export type FailureKind = 'quota' | 'rate-limited' | 'unclassified'

/** Quota, budget, billing, and usage-limit exhaustion. Checked first. */
const QUOTA_WORDING: readonly string[] = [
  'insufficient_quota',
  'out of budget',
  'quota exceeded',
  'billing',
  'gousagelimiterror',
  'freeusagelimiterror',
  'monthly usage limit reached',
  'available balance',
]

const RATE_LIMITED = /rate.?limit|too many requests|429/i

export function classifyFailureKind(reason: string | null): FailureKind {
  if (reason === null) return 'unclassified'
  const lowered = reason.toLowerCase()
  if (QUOTA_WORDING.some((wording) => lowered.includes(wording))) return 'quota'
  if (RATE_LIMITED.test(reason)) return 'rate-limited'
  return 'unclassified'
}

/** What the failure says about what to do next; null says nothing extra. */
export function failureRemedy(kind: FailureKind): string | null {
  switch (kind) {
    case 'quota':
      return (
        'This is a quota or billing limit on the provider account, not a temporary ' +
        'throttle — waiting will not lift it. Check the plan and billing settings.'
      )
    case 'rate-limited':
      return (
        'The provider throttled this request. It was retried automatically before ' +
        'failing; sending it again after a wait is safe.'
      )
    case 'unclassified':
      return null
  }
}
