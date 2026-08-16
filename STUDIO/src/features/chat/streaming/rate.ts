/**
 * How fast text is actually arriving.
 *
 * The reveal has to be paced by something, and the only honest source is the
 * stream itself. A fixed rate is wrong in both directions: pick 40 chars/s and
 * a fast model spends the whole reply thousands of characters behind; pick
 * 900 and a slow one reveals its buffer in a burst and then sits blank.
 *
 * So this measures. Each arrival contributes chars-per-second, and an
 * exponential moving average smooths it, because arrivals are lumpy -- a
 * transport delivers three tokens in one frame and then nothing for 80ms, and
 * pacing off the last sample alone would make the text pulse at exactly that
 * lumpiness.
 */

/** Weight of each new sample. Low enough to ignore one late packet. */
const ALPHA = 0.2

/**
 * Samples further apart than this start a new measurement rather than
 * contributing a near-zero rate. A gap this long is the model pausing, or the
 * turn starting -- not evidence that it types slowly.
 */
const GAP_MS = 900

/** Where the estimate starts, and what it falls back to. Roughly 45 tokens/s. */
export const DEFAULT_CPS = 180

export interface RateEstimator {
  /** Record that `chars` more characters arrived, and return the new estimate. */
  sample(chars: number, at: number): number
  /** The current estimate in characters per second. */
  readonly value: number
  reset(): void
}

export function createRateEstimator(): RateEstimator {
  let value = DEFAULT_CPS
  let last = 0
  let seeded = false

  return {
    get value() {
      return value
    },

    reset() {
      value = DEFAULT_CPS
      last = 0
      seeded = false
    },

    sample(chars, at) {
      const elapsed = at - last
      last = at

      // Nothing to learn from: no growth, no clock, or a gap that says the
      // model stopped rather than slowed.
      if (chars <= 0 || elapsed <= 0 || elapsed > GAP_MS) return value

      const instant = (chars / elapsed) * 1000

      // The first real sample replaces the default outright. Blending into it
      // would make the opening second of every reply pace itself off a number
      // that was never measured.
      value = seeded ? value + ALPHA * (instant - value) : instant
      seeded = true
      return value
    },
  }
}
