import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton, Tooltip } from '@/components/primitives'
import { DURATION, EASE_IN, EASE_OUT, ENTER } from '@/design/tokens'

/**
 * Two parts move together. The dock opens the room, so the box grows rather
 * than jumps, and the strip rises into that room from behind the box's edge.
 * Leaving runs the same way back on the exit curve.
 */
const DOCK: Variants = {
  closed: { height: 0, transition: { duration: DURATION.base, ease: EASE_IN } },
  open: { height: 'auto', transition: { duration: DURATION.slow, ease: EASE_OUT } },
}
const STRIP: Variants = {
  closed: { opacity: 0, y: 10, scale: 0.98, transition: { duration: DURATION.base, ease: EASE_IN } },
  open: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } },
}

/**
 * The passage this message replies to, docked at the top of the composer.
 *
 * One line however long the passage is: the strip names what is being answered
 * and the words below stay the message. The whole passage still goes with the
 * send, and a tooltip shows it. The arrow lines up with the paperclip and the
 * cross with send, as in the reference.
 */
export function QuoteStrip({ quote, onRemove }: { quote: string; onRemove: () => void }) {
  const line = quote.replace(/\s+/g, ' ')
  return (
    <AnimatePresence initial={false}>
      {quote !== '' ? (
        <motion.div
          key="dock"
          variants={DOCK}
          initial="closed"
          animate="open"
          exit="closed"
          className="studio-composer-quote-dock"
        >
          <motion.div variants={STRIP} className="studio-composer-quote">
            <Icons.reply size="md" />
            <div className="min-w-0 flex-1">
              {/* A second Reply replaces the passage in place. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={line}
                  initial={ENTER.initial}
                  animate={ENTER.animate}
                  exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_IN } }}
                  transition={{ duration: DURATION.base, ease: EASE_OUT }}
                >
                  <Tooltip label={line}>
                    <p className="truncate text-ui">{line}</p>
                  </Tooltip>
                </motion.div>
              </AnimatePresence>
            </div>
            <IconButton label="Remove quote" size="xs" tone="wash" onClick={onRemove} className="-ml-[7px]">
              <Icons.close size="md" />
            </IconButton>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
