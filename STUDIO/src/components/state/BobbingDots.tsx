import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'

/**
 * Three dots bobbing in turn: the app's one wait.
 *
 * Each dot drops and returns on its own beat, a fifth of a second behind
 * the one before, so the row reads as a wave rolling through it. A body in
 * motion rather than a shape turning: the ring that stood here before
 * (`WorkingRing`) is the composer's halo round the stop control, and alone
 * in a page it turned unevenly and read as broken; the breathing dots
 * before that, alone in a page, read as any app's. This one moves, which
 * is what "working" looks like.
 *
 * The travel is a dot and a quarter, so a bigger wait bobs further, and
 * the dots take the text colour around them. One second a bob, ease in and
 * out: a wait, not a hurry. Pixels, not ems: the recipe this follows moves
 * the dots by `0.625em` of a 16px root - ten pixels under dots of about
 * eight - and this app's motion library does not interpolate a number into
 * an em length, so written that way the dots simply stood still.
 */
export function BobbingDots({
  className,
  size = 6,
}: {
  className?: string
  /** A dot's diameter in px; the gap and the travel scale with it. */
  size?: number
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center', className)}
      style={{ gap: size * 0.8 }}
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="block rounded-full bg-current"
          style={{ width: size, height: size }}
          initial={{ y: 0 }}
          animate={{ y: [0, size * 1.25, 0] }}
          transition={{ duration: 1, repeat: Infinity, repeatType: 'loop', delay: index * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}
