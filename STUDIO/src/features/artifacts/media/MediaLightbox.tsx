import { motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SURFACE } from '@/design/tokens'
import { Overlay } from '@/components/primitives'
import { MediaViewer } from '@/features/artifacts/media/MediaViewer'
import type { MediaOutput } from '@/domain/artifacts/media'

/**
 * The viewer where no page hosts it: over everything, on the scrim.
 *
 * The chat page lays the viewer over its transcript and keeps the composer
 * under it (`MediaViewerHostContext`); this is the same viewer for anywhere
 * else - the showcase, a gallery - with no composer, so Markup and Comment
 * take their own field. Escape and a click outside the picture close it
 * (`Overlay`).
 *
 * Not fullscreen: fullscreen is a mode, and looking at what the model just
 * made is a glance in the middle of a conversation.
 */
export function MediaLightbox({
  open,
  onClose,
  title,
  model,
  video,
  output,
  onKeep,
}: {
  open: boolean
  onClose: () => void
  title: string
  model?: string | null
  video: boolean
  output: MediaOutput | null
  onKeep?: () => void
}) {
  return (
    // Raised above the dialog layer: a lightbox can be opened from inside one.
    <Overlay open={open && output !== null} onClose={onClose} raised className="p-3">
      {output !== null ? (
        <motion.div
          role="dialog"
          aria-modal
          aria-label={title}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.base, ease: EASE_IN } }}
          transition={SPRING_SURFACE}
          className="size-full min-h-0"
        >
          <MediaViewer
            spec={{ output, title, model, video, ...(onKeep === undefined ? {} : { onKeep }) }}
            onClose={onClose}
            composer={false}
          />
        </motion.div>
      ) : null}
    </Overlay>
  )
}
