import { useEffect, useRef, useState } from 'react'
import { createRateEstimator, DEFAULT_CPS } from '@/features/chat/streaming/rate'

/**
 * The reveal clock.
 *
 * Between the transport and the screen sits a buffer. Text goes in at whatever
 * rate the model and the network produce it — lumpy, bursty, and anywhere from
 * 20 to 1000 tokens a second — and comes out on a frame clock at a rate that
 * tracks the measured average rather than the instantaneous one.
 *
 * That single indirection is what makes fast and slow models look the same.
 * Rendering arrivals directly means the UI inherits every stutter in the
 * pipeline: a burst of 200 characters lands in one frame as a paragraph
 * appearing at once, and the 90ms of silence after it reads as a hang. Paced
 * off the average, the same stream is a steady line of text.
 *
 * ---- Why it is allowed to fall behind, and how it catches up -------------
 *
 * Pacing off the average alone would drift permanently behind a model that
 * accelerates. So the rate is multiplied by a factor that grows with the
 * backlog: a little behind and it reveals at very nearly the measured rate; a
 * long way behind and it moves at several times that until the gap closes.
 * The curve is gentle on purpose — snapping to the end on every overshoot is
 * the stutter this exists to remove.
 *
 * When the stream ends the backlog is drained rather than dropped, quickly
 * enough that nobody waits for the last sentence and smoothly enough that the
 * reply does not end with a jump.
 */

/** Slowest the text may reveal, chars/s. Below this a long reply feels stalled. */
const MIN_CPS = 55

/** Fastest, chars/s. Past this the eye cannot follow it as text anyway. */
const MAX_CPS = 1600

/** Backlog at which catch-up reaches its ceiling. */
const CATCHUP_SCALE = 320

/** Ceiling on the catch-up multiplier. */
const CATCHUP_MAX = 5

/** After the stream ends, drain whatever is left within about this long. */
const DRAIN_SECONDS = 0.35

/**
 * Reveal `target` progressively while `active`, and settle on it when not.
 *
 * Returns the text that should be on screen this frame. The value is a prefix
 * of `target`, so every consumer downstream — the segmenter, the markdown
 * parser, the code blocks — sees ordinary, valid, growing text and needs to
 * know nothing about streaming.
 */
export function useSmoothText(target: string, active: boolean): string {
  const [shown, setShown] = useState(() => (active ? 0 : target.length))

  const rate = useRef(createRateEstimator())
  const previous = useRef(target)
  const length = useRef(shown)
  const frame = useRef(0)

  // Measured on arrival, not in the frame loop: this effect runs exactly when
  // new text lands, which is the event whose spacing is being measured.
  useEffect(() => {
    // Not a continuation. A retry, an edit, or a different message reusing the
    // hook — in each case there is no reveal to continue, so present the new
    // text as it is rather than typing it out from wherever we happened to be.
    if (!target.startsWith(previous.current)) {
      rate.current.reset()
      length.current = target.length
      setShown(target.length)
      previous.current = target
      return
    }

    rate.current.sample(target.length - previous.current.length, performance.now())
    previous.current = target
  }, [target])

  useEffect(() => {
    if (length.current >= target.length && !active) return

    // The whole point is a per-frame reveal, so `matchMedia` is checked here
    // rather than branching in a component: with reduced motion the text simply
    // appears, which is the correct interpretation of the preference.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      length.current = target.length
      setShown(target.length)
      return
    }

    let last = performance.now()

    const step = (now: number) => {
      // Clamped, because a backgrounded window delivers one frame with a delta
      // of several seconds, and multiplying the rate by that dumps the entire
      // buffer at once on return.
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now

      const backlog = target.length - length.current

      if (backlog <= 0) {
        if (!active) return
        frame.current = requestAnimationFrame(step)
        return
      }

      const measured = rate.current.value || DEFAULT_CPS
      const catchup = Math.min(1 + backlog / CATCHUP_SCALE, CATCHUP_MAX)

      // Once the stream is over there is nothing left to pace against, so the
      // floor becomes "finish in DRAIN_SECONDS" instead of the measured rate.
      const wanted = active ? measured * catchup : Math.max(measured * catchup, backlog / DRAIN_SECONDS)

      const next = Math.min(
        target.length,
        length.current + Math.max(MIN_CPS, Math.min(wanted, MAX_CPS)) * delta,
      )

      // Whole characters only. Committing a fraction would re-render on frames
      // that change nothing on screen.
      if (Math.floor(next) > Math.floor(length.current)) setShown(Math.floor(next))
      length.current = next

      if (active || next < target.length) frame.current = requestAnimationFrame(step)
    }

    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [target, active])

  return shown >= target.length ? target : target.slice(0, shown)
}
