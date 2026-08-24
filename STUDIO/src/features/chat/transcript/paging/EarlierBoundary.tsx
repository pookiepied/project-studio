import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { StudioMark } from '@/components/brand'

/**
 * The top of what is loaded.
 *
 * It holds a fixed height whether or not a batch is arriving, which is the
 * point: a boundary that appears and disappears would change the document's
 * height at exactly the moment older turns are being inserted above it, and
 * the scroll compensation in `useTranscriptWindow` would be correcting for two
 * things at once and get neither right.
 *
 * The mark is the app's own, busy. Anything else here — a spinner, a
 * "loading…" label, a skeleton row — would be a second vocabulary for the one
 * idea the brand already expresses, and a skeleton in particular pretends to be
 * content, which at the top of a history is a lie about what you are about to
 * read.
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
            <StudioMark busy size={16} className="text-foreground/40" />
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
