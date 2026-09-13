import { motion } from 'framer-motion'
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
export function WorkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex items-center gap-[3px] align-middle', className)}>
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-[3px] rounded-full bg-current"
          animate={{ opacity: [0.25, 0.85, 0.25] }}
          transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity, delay: index * 0.36 }}
        />
      ))}
    </span>
  )
}
