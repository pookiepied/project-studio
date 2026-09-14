import { motion } from 'framer-motion'
import { LOOP } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A ring travelling round a circle: the app's one mark for "working, no
 * progress to report".
 *
 * Indeterminate on purpose: nothing that shows this knows how long the
 * thing will take, so the ring reports activity and never progress. A bar
 * that filled would be inventing a fraction of a duration nobody measured.
 *
 * A stroked circle rather than a bordered box: `pathLength` normalises the
 * circumference to 100 so the dash is a plain percentage of the way round,
 * round caps give the arc ends instead of mitres, and `non-scaling-stroke`
 * holds the line at ~1.4px at every size, the way the icon set holds its
 * own weight. A quarter of the way round, with a gap for the rest - long
 * enough to read as travelling, short enough that the gap is what the eye
 * follows.
 *
 * It began as the composer's halo round the stop control while a turn is
 * in flight, and that is still where it is most seen; the composer hangs
 * this same ring outside the button's rim. Standing alone it is the wait
 * for a page or a pane (`Loading`).
 */
export function WorkingRing({ className, size }: { className?: string; size?: number }) {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('pointer-events-none', className)}
      animate={{ rotate: 360 }}
      transition={LOOP.spin}
    >
      <circle
        cx="12"
        cy="12"
        r="10.9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={100}
        strokeDasharray="25 75"
        opacity={0.75}
      />
    </motion.svg>
  )
}
