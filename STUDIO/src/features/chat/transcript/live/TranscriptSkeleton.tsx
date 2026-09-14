import { motion } from 'framer-motion'
import { Placeholder, PlaceholderText } from '@/components/placeholder/Placeholder'
import { DURATION, EASE_OUT } from '@/design/tokens'

/**
 * The transcript before it has arrived: a picture of a conversation's
 * layout, in the place the conversation will take.
 *
 * Opening a conversation used to print "Reaching the conversation…" between
 * the transcript and the composer while the replay came in - a sentence
 * about the connection, in the connection's spot, above an empty page. The
 * empty page was the thing the reader was looking at. This stands where the
 * words will stand, shaped as they will be shaped - a message of theirs on
 * the right, an answer on the left - so what follows is a change of fill,
 * not an appearance (`Placeholder`).
 *
 * It arrives late on purpose. A replay from a local harness usually lands
 * in a few frames, and a skeleton that showed for those frames would flash
 * once and be gone; it fades in only once the wait is long enough to be a
 * wait (`SHOW_AFTER`), the same rule `Deferred` keeps for a chunk.
 */

/** How long the wait is invisible before the skeleton shows, in seconds. */
const SHOW_AFTER = 0.15

export function TranscriptSkeleton() {
  return (
    <motion.div
      role="status"
      aria-label="Loading the conversation"
      className="flex flex-col gap-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: SHOW_AFTER }}
    >
      <div className="flex flex-col items-end">
        <Placeholder className="h-10 w-[46%] rounded-2xl rounded-br-md" />
      </div>
      <div className="flex flex-col gap-2">
        <PlaceholderText width="92%" />
        <PlaceholderText width="78%" />
        <PlaceholderText width="58%" />
      </div>
      <div className="flex flex-col items-end">
        <Placeholder className="h-10 w-[32%] rounded-2xl rounded-br-md" />
      </div>
      <div className="flex flex-col gap-2">
        <PlaceholderText width="84%" />
        <PlaceholderText width="66%" />
      </div>
    </motion.div>
  )
}
