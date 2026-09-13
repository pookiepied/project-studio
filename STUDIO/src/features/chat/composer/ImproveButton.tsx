import { motion } from 'framer-motion'
import { DURATION, LOOP } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import type { ImproveOffer } from '@/features/chat/composer/useImproveOffer'

/**
 * The offer to tidy a dictated message, as one control in the composer's
 * row - beside dictate, the same size as dictate.
 *
 * It was first a caption row under the field and then a pill above it, and
 * both added a line to the composer for a verb that acts on the field. The
 * controls that act on the field sit in its row; this one does too. Nothing
 * grows when the offer appears and nothing shrinks when it goes.
 *
 * Three states, one button:
 *
 *   ready      the generate mark. Click runs it on the whole field.
 *   working    the same mark, breathing (`LOOP.pulse`), the button held.
 *              The working state is the button's own motion, not a word
 *              beside it: the row has no room for a word and needs none.
 *   improved   the undo mark, while the field is still the model's text.
 */
export function ImproveButton({
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
    <IconButton
      label={working ? 'Improving' : improved ? 'Undo improve' : 'Improve'}
      size="md"
      disabled={working}
      onClick={improved ? onUndo : onImprove}
    >
      <motion.span
        className="inline-flex"
        animate={working ? { opacity: [1, 0.3, 1], scale: [1, 0.88, 1] } : { opacity: 1, scale: 1 }}
        transition={working ? LOOP.pulse : { duration: DURATION.fast }}
      >
        {improved ? <Icons.undo size="md" /> : <Icons.generate size="md" />}
      </motion.span>
    </IconButton>
  )
}
