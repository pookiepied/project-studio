import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'

/**
 * A passage arriving in the field, word by word.
 *
 * Two things put whole passages into the composer at once: a dictation take
 * landing, and Improve handing back its rewrite. A textarea cannot show
 * either as anything but a cut - one frame empty, the next frame full - and
 * a cut is the reading "the app pasted something". This is the alternative:
 * for the length of one slow duration the field's slot shows the words
 * themselves, each rising into place a beat after the one before, in the
 * field's own type so nothing moves when the real field takes over.
 *
 * The spread is fixed, not the step. A long passage does not take longer to
 * land than a short one - every word's delay is a share of `DURATION.slow`,
 * so the last word always starts inside the ceiling the motion rules set,
 * and only its own fade (`DURATION.base`) runs past it. Short passages get
 * the per-word step capped so three words do not arrive as one.
 */

/** The longest one word waits behind the one before it. */
const STEP_MAX = 0.035

export function landingDuration(text: string): number {
  const words = countWords(text)
  return stepFor(words) * Math.max(0, words - 1) + DURATION.base
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

function stepFor(words: number): number {
  return Math.min(STEP_MAX, DURATION.slow / Math.max(1, words))
}

export function TextLanding({ text }: { text: string }) {
  const words = text.split(/(\s+)/)
  const step = stepFor(countWords(text))
  let index = 0
  return (
    <div
      aria-live="polite"
      className="whitespace-pre-wrap break-words text-ui text-foreground"
      style={{ minHeight: 'calc(var(--text-ui) * var(--leading-ui))' }}
    >
      {words.map((part, at) => {
        // Whitespace is kept as-is between the words so the wrap matches the
        // field's; only the words animate.
        if (part === '' || /^\s+$/.test(part)) return <span key={at}>{part}</span>
        const delay = step * index
        index += 1
        return (
          <motion.span
            key={at}
            className="inline-block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT, delay }}
          >
            {part}
          </motion.span>
        )
      })}
    </div>
  )
}
