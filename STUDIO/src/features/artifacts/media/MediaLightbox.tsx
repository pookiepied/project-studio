import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SURFACE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { VideoPlayer } from '@/features/artifacts/media/VideoPlayer'

/**
 * A generated image or clip, opened larger.
 *
 * ---- Why not fullscreen ---------------------------------------------------
 *
 * Fullscreen is a mode: the window furniture goes, the app is gone, and coming
 * back is a deliberate act. That is right for watching something and wrong for
 * *looking at* something the model just made, which is a glance you take in the
 * middle of a conversation. So this takes about three quarters of the window
 * and leaves the rest visible behind a scrim -- big enough to judge the result,
 * small enough that the conversation is still obviously there and one click
 * away.
 *
 * It is the same object it was in the transcript, only larger: the card, the
 * inset panel, the caption underneath. Opening a picture into a
 * differently-shaped container makes it read as a new screen rather than as the
 * same thing brought closer.
 */
export function MediaLightbox({
  open,
  onClose,
  title,
  caption,
  video,
  src,
  poster,
}: {
  open: boolean
  onClose: () => void
  title: string
  caption?: string
  video: boolean
  src?: string
  poster?: string
}) {
  // Bound to the document, not the panel: bound to the panel it stops working
  // the moment focus moves into the player's own controls, which is precisely
  // when someone reaches for Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          className="studio-blur-scrim fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-8"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } }}
            transition={SPRING_SURFACE}
            // Three quarters of the window, and no more than the media needs.
            // `max-height` matters as much as width: without it a portrait clip
            // in a short window overflows the viewport and the caption goes
            // somewhere you cannot reach.
            className="flex w-[75vw] max-w-[1100px] flex-col rounded-block bg-surface-raised p-2 shadow-modal"
            style={{ maxHeight: '82vh' }}
          >
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-block-inner bg-black">
              {video && src ? (
                <VideoPlayer src={src} poster={poster} title={title} autoPlay />
              ) : (
                <img
                  src={src ?? poster}
                  alt={title}
                  className="size-full max-h-[74vh] object-contain"
                />
              )}
            </div>

            <div className="flex h-8 shrink-0 items-center gap-2 px-2">
              <span className="min-w-0 truncate text-micro text-muted-foreground">
                {caption ?? title}
              </span>
              <span className="ml-auto shrink-0">
                <IconButton label="Close" size="sm" onClick={onClose}>
                  <Icons.close />
                </IconButton>
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
