import { motion } from 'framer-motion'
import { LOOP } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * Three dots, for a step that is running.
 *
 * Beside a label rather than replacing it: "Searching" that becomes
 * "Searching…" tells you it is live without the label changing, so the line
 * does not reflow when it finishes. The dots take the text colour around
 * them, which is how a status line, a dictation bar and a read-aloud pill
 * all show the same mark without each choosing a colour for it.
 *
 * ---- One clock ------------------------------------------------------------
 *
 * Three copies of this used to exist, and two of them ran the dots a sixth
 * of a cycle apart while the third ran them a third apart. The third was
 * right: a third of the cycle is what makes three dots read as one wave
 * travelling left to right rather than three things blinking near each
 * other. The pace itself is unhurried on purpose -- this is a wait.
 */
export function WorkingDots({
  className,
  size = 'sm',
}: {
  className?: string
  /** `sm` sits inside a line of text; `md` stands alone as a wait (`Loading`). */
  size?: 'sm' | 'md'
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center align-middle',
        size === 'sm' ? 'gap-[3px]' : 'gap-[5px]',
        className,
      )}
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className={cn('rounded-full bg-current', size === 'sm' ? 'size-[3px]' : 'size-1.5')}
          animate={{ opacity: [0.25, 0.85, 0.25] }}
          transition={{ ...LOOP.pulse, delay: index * (LOOP.pulse.duration / 3) }}
        />
      ))}
    </span>
  )
}
