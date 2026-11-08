import { motion } from 'framer-motion'

/**
 * A conversation that is working.
 *
 * Family A's working mark: a ring of round dots chasing around a circle. The
 * head is the accent and the largest; each dot behind it is a little smaller
 * and fades from blue toward grey, so the ring reads as one thing moving
 * rather than twelve lights. It turns a dot at a time, not smoothly - the
 * step is what makes a ring of dots read as a chase rather than a rotating
 * picture of one.
 *
 * ---- Why it is not a percentage or a count -------------------------------
 *
 * Neither is knowable. A reply has no length until it has finished, so any
 * progress figure would be invented, and an invented number in a quiet corner
 * of the interface is the kind of thing people learn to distrust the whole
 * chrome over. "Working" is the entire truth available, so it is the entire
 * claim made.
 */

const DOTS = 12
/** One full turn, in seconds: a dot every 80ms. */
const TURN = 0.96

/** Moves only on each dot's beat, so the head jumps dot to dot. */
const stepped = (progress: number) => Math.floor(progress * DOTS) / DOTS

export function ActivityMark({ size = 14, label = 'Working' }: { size?: number | string; label?: string }) {
  return (
    <motion.svg
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      className="block shrink-0 text-accent"
      style={{ width: size, height: size }}
      animate={{ rotate: 360 }}
      transition={{ duration: TURN, ease: stepped, repeat: Infinity }}
    >
      {Array.from({ length: DOTS }, (_, index) => {
        // 0 at the head, 1 at the very end of the tail.
        const behind = index / (DOTS - 1)
        const angle = (-index * 2 * Math.PI) / DOTS
        return (
          <circle
            key={index}
            cx={12 + 9 * Math.sin(angle)}
            cy={12 - 9 * Math.cos(angle)}
            r={1.9 - behind * 0.7}
            // The head third is the accent; the rest goes over to the
            // interface's grey as it fades, as the reference's tail does.
            fill={behind < 0.34 ? 'currentColor' : 'var(--muted-foreground)'}
            opacity={1 - behind * 0.8}
          />
        )
      })}
    </motion.svg>
  )
}
