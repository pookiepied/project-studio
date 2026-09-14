import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { BobbingDots } from '@/components/state'
import { DURATION, EASE_OUT } from '@/design/tokens'

/**
 * The conversation's wait: three dots bobbing in the empty page while the
 * history is read and landed on (see "The open" in `useAutoScroll`).
 *
 * The one drawn wait in the app. Every other page shows nothing while it
 * loads and lets its rows arrive (`Loading`); a conversation is different
 * because its history can be long, the page is empty until all of it is
 * here, and an empty page that says nothing for half a second looks like
 * an app that has stopped. The dots were briefly the wait everywhere, and
 * on a settings pane they read as a widget where content should be.
 *
 * It arrives late (`SHOW_AFTER`): a short history lands in a few frames,
 * and dots that showed for those frames would be the only thing seen of
 * it. It leaves quickly, fading under the words as they rise.
 */

/** How long the wait is invisible before the dots show, in seconds. */
const SHOW_AFTER = 0.15

export function TranscriptWait({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <motion.div
      role="status"
      aria-label="Loading the conversation"
      className={className}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: SHOW_AFTER }}
    >
      <BobbingDots className="text-muted-foreground" />
    </motion.div>
  )
}
