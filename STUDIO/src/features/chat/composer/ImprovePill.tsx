import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, LOOP } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { WorkingDots } from '@/components/state'
import type { ImproveOffer } from '@/features/chat/composer/useImproveOffer'
import { cn } from '@/lib/cn'

/**
 * The offer to tidy a dictated message, as one small pill above the field.
 *
 * It was a caption row - "Dictated - Improve" - and the row read as a
 * label on the field: a status the composer was announcing about itself,
 * under every dictated message, whether or not anyone wanted the words
 * changed. This is an offer, so it looks like one: a single pill, the
 * generate mark and a verb, sitting where a tip sits, that a person can
 * take or leave.
 *
 * Three faces, one pill, and the pill itself never leaves between them -
 * the contents crossfade inside it so the eye stays on the same object:
 *
 *   ready      the mark and "Improve". Click runs it on the whole field.
 *   working    the mark breathes (`LOOP.pulse`) beside "Improving" and the
 *              dots: a state being reported, not decoration.
 *   improved   "Improved", and Undo beside it while the field is still the
 *              model's text.
 *
 * A refusal keeps the pill on ready and puts the model's one sentence
 * after it, in the caption voice, until the next try.
 */
export function ImprovePill({
  offer,
  onImprove,
  onUndo,
}: {
  offer: ImproveOffer
  onImprove: () => void
  onUndo: () => void
}) {
  const working = offer.state === 'working'
  const improved = offer.state === 'improved'
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption" role="status">
      <motion.button
        type="button"
        layout
        disabled={working || improved}
        onClick={onImprove}
        aria-label={working ? 'Improving the message' : improved ? 'Improved' : 'Improve the message'}
        className={cn(
          'inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-surface-raised pl-2 pr-2.5',
          'text-caption text-foreground/85 transition-colors duration-fast',
          'enabled:hover:border-border enabled:hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-default',
        )}
      >
        <motion.span
          className="inline-flex"
          animate={working ? { opacity: [1, 0.35, 1], scale: [1, 0.92, 1] } : { opacity: 1, scale: 1 }}
          transition={working ? LOOP.pulse : { duration: DURATION.fast }}
        >
          <Icons.generate size="sm" />
        </motion.span>
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={offer.state}
            className="inline-flex items-center gap-1.5"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            {working ? (
              <>
                Improving
                <WorkingDots />
              </>
            ) : improved ? (
              'Improved'
            ) : (
              'Improve'
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      <AnimatePresence initial={false}>
        {improved ? (
          <motion.button
            key="undo"
            type="button"
            onClick={onUndo}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Undo
          </motion.button>
        ) : null}
      </AnimatePresence>
      {offer.note !== null ? <span className="text-muted-foreground">{offer.note}</span> : null}
    </div>
  )
}
