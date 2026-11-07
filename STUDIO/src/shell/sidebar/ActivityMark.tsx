import { motion } from 'framer-motion'
import { LOOP } from '@/design/tokens'

/**
 * A conversation that is working while you are somewhere else.
 *
 * Family A's own working mark: a thin ring of short ticks, strongest at its head
 * and fading around the circle, turning. Lighter than a spinner's solid arc, which
 * in a row reads as "this row is loading", when the row is fine and the work is in
 * the thing it points at.
 *
 * ---- Why it is not a percentage or a count -------------------------------
 *
 * Neither is knowable. A reply has no length until it has finished, so any
 * progress figure would be invented, and an invented number in a quiet corner
 * of the interface is the kind of thing people learn to distrust the whole
 * chrome over. "Working" is the entire truth available, so it is the entire
 * claim made.
 */

const TICKS = 12
const FAINTEST = 0.15

export function ActivityMark({ size = 14 }: { size?: number }) {
  return (
    <motion.svg
      role="img"
      aria-label="Working"
      viewBox="0 0 24 24"
      className="block shrink-0 text-accent"
      style={{ width: size, height: size }}
      animate={{ rotate: 360 }}
      transition={{ ...LOOP.spin, duration: 1.4 }}
    >
      {Array.from({ length: TICKS }, (_, index) => (
        <line
          key={index}
          x1="12"
          y1="1.5"
          x2="12"
          y2="4.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity={1 - (index / TICKS) * (1 - FAINTEST)}
          transform={`rotate(${-index * (360 / TICKS)} 12 12)`}
        />
      ))}
    </motion.svg>
  )
}
