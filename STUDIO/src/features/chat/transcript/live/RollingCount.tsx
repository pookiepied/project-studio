import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The count on a running chip, arriving.
 *
 * ---- What the ramp is, and is not ----------------------------------------
 *
 * A call's input lands whole: the wire carries it as one fact, so the lines
 * a write will produce do not trickle in anywhere this window can watch. A
 * live chip therefore does not count real arrival -- nothing arrives. What
 * it does is arrive itself: the count starts at nothing and climbs to the
 * fact over a beat, the same entrance the chip's own fade gives the row, and
 * then rests there while the call runs. The number it rests on is the fact;
 * the ramp is pacing, not a progress report, and it is drawn only for a turn
 * being written now -- history renders its count already settled.
 *
 * ---- The pop --------------------------------------------------------------
 *
 * A digit that has just changed pops in, slightly small and low, and springs
 * to rest -- transitions.dev's number-pop-in -- so a climbing count reads as
 * digits arriving rather than as a number flickering. A digit that has not
 * changed keeps its identity and does not move: the key carries the digit.
 */
/** The ramp's tick. Exported because the tick test steps exactly one of them. */
export const STEP_MS = 32

export function RollingCount({ value, live }: { value: number; live: boolean }) {
  const [shown, setShown] = useState(() => (live ? 0 : value))

  useEffect(() => {
    if (!live) {
      // History, or an answered call: the fact, immediately.
      setShown(value)
      return
    }
    // A live count ramps from where it STANDS. On the mount that is nothing,
    // so the count arrives; on a later fact -- a run's second edit ticking
    // the number in place -- it climbs from the number already on screen,
    // which is the whole point of a row that mutates instead of respawning.
    // Bounded steps: a three-line write lands in a few ticks, a five-hundred
    // line one in well under a second -- the ramp stays an entrance at every
    // size instead of scaling into a progress bar.
    const step = Math.max(1, Math.ceil(value / Math.min(28, Math.max(6, Math.round(value / 4)))))
    const interval = window.setInterval(() => {
      setShown((current) => {
        const next = current + step
        if (next >= value) {
          window.clearInterval(interval)
          return value
        }
        return next
      })
    }, STEP_MS)
    return () => window.clearInterval(interval)
  }, [live, value])

  const counting = live && shown < value
  const text = String(shown)

  return (
    <span className={cn('inline-block tabular-nums', counting && 'studio-shimmer')}>
      {[...text].map((digit, index) => (
        <motion.span
          key={`${index}-${digit}`}
          initial={{ opacity: 0, y: -3, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          className="inline-block"
        >
          {digit}
        </motion.span>
      ))}
    </span>
  )
}
