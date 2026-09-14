import { motion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { DURATION, EASE_OUT } from '@/design/tokens'

/**
 * The transcript before it has arrived: the mark, busy, alone in the page.
 *
 * Opening a conversation used to print "Reaching the conversation…" between
 * the transcript and the composer while the replay came in - a sentence
 * about the connection, in the connection's spot, above an empty page. The
 * empty page was the thing the reader was looking at, so the wait is drawn
 * there now, and it is drawn as the one thing the app already uses for
 * "loading": the brand mark breathing (`EarlierBoundary` shows the same for
 * an older batch). A skeleton stood here for one commit and was refused; it
 * is a picture of content that is not there, and `EarlierBoundary` had
 * already said why that is a lie at the top of a history.
 *
 * It arrives late on purpose. A replay from a local harness usually lands
 * in a few frames, and a mark that showed for those frames would flash once
 * and be gone; it fades in only once the wait is long enough to be a wait
 * (`SHOW_AFTER`). When the words come it fades out under them as they rise
 * (`ChatPage`).
 */

/** How long the wait is invisible before the mark shows, in seconds. */
const SHOW_AFTER = 0.15

export function TranscriptLoading() {
  return (
    <motion.div
      role="status"
      aria-label="Loading the conversation"
      className="flex justify-center py-24"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: SHOW_AFTER }}
    >
      <StudioMark busy size={28} className="text-foreground/40" />
    </motion.div>
  )
}
