import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { WorkingRing } from '@/components/state'

/**
 * The top of what is loaded.
 *
 * It holds a fixed height whether or not a batch is arriving, which is the
 * point: a boundary that appears and disappears would change the document's
 * height at exactly the moment older turns are being inserted above it, and
 * the scroll compensation in `useTranscriptWindow` would be correcting for two
 * things at once and get neither right.
 *
 * The wait is the app's one wait, the ring. Anything else here — a
 * "loading…" label, a skeleton row — would be a second vocabulary for one
 * idea, and a skeleton in particular pretends to be content, which at the
 * top of a history is a lie about what you are about to read. The brand mark
 * stood here for a while; it is the app's face, not its hourglass.
 */
export function EarlierBoundary({
  loading,
  ref,
}: {
  loading: boolean
  ref: (node: HTMLElement | null) => void
}) {
  return (
    <div ref={ref} className="flex h-12 shrink-0 items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            <WorkingRing size={16} className="text-muted-foreground" />
          </motion.div>
        ) : (
          <motion.span
            key="rule"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="text-micro text-muted-foreground/60"
          >
            Earlier in this conversation
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
