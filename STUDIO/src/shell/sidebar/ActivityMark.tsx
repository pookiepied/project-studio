import { motion } from 'framer-motion'

/**
 * A conversation that is working while you are somewhere else.
 *
 * ---- Why a matrix and not a spinner --------------------------------------
 *
 * A spinner in a sidebar row means "this row is loading", which is a statement
 * about the *list*. What is happening here is the opposite: the row is fine,
 * and something is happening in the thing it points at. Those need to look
 * different or the sidebar reads as half-broken whenever two replies are in
 * flight.
 *
 * So it is the brand's own vocabulary, small: a grid of cells lighting in a
 * travelling order, the same idea the mark uses while thinking. Seeing three
 * rows carrying it at once should read as three conversations working, not as
 * three errors.
 *
 * ---- Why it is not a percentage or a count -------------------------------
 *
 * Neither is knowable. A reply has no length until it has finished, so any
 * progress figure would be invented, and an invented number in a quiet corner
 * of the interface is the kind of thing people learn to distrust the whole
 * chrome over. "Working" is the entire truth available, so it is the entire
 * claim made.
 */

/** Cell coordinates, in the order they light. A diagonal sweep. */
const CELLS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [2, 0],
  [1, 1],
  [0, 2],
  [2, 1],
  [1, 2],
  [2, 2],
] as const

const SIZE = 3
const GAP = 1.5

export function ActivityMark({ size = 10 }: { size?: number }) {
  const cell = (size - GAP * (SIZE - 1)) / SIZE

  return (
    <span
      role="img"
      aria-label="Working"
      className="relative inline-block shrink-0 text-foreground/70"
      style={{ width: size, height: size }}
    >
      {CELLS.map(([x, y], index) => (
        <motion.span
          key={`${x}-${y}`}
          className="absolute rounded-[1px] bg-current"
          style={{
            width: cell,
            height: cell,
            left: x * (cell + GAP),
            top: y * (cell + GAP),
          }}
          animate={{ opacity: [0.12, 0.9, 0.12] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            ease: 'easeInOut',
            // Spread across the cycle rather than a fixed step, so the sweep
            // wraps continuously instead of restarting with a visible gap.
            delay: (index / CELLS.length) * 1.6,
          }}
        />
      ))}
    </span>
  )
}
