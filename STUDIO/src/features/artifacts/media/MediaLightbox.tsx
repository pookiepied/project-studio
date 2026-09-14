import { motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SURFACE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, Overlay } from '@/components/primitives'
import { Deferred, lazyNamed } from '@/components/state'
import { useMediaSource } from '@/features/artifacts/media/source'
import type { MediaOutput } from '@/domain/artifacts/media'

const VideoPlayer = lazyNamed(
  () => import('@/features/artifacts/media/VideoPlayer'),
  'VideoPlayer',
)

/**
 * A generated image or clip, opened larger.
 *
 * ---- Why not fullscreen ---------------------------------------------------
 *
 * Fullscreen is a mode: the window furniture goes, the app is gone, and coming
 * back is a deliberate act. That is right for watching something and wrong for
 * *looking at* something the model just made, which is a glance you take in the
 * middle of a conversation. So this takes about three quarters of the window
 * and leaves the rest visible behind a scrim — big enough to judge the result,
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
  output,
}: {
  open: boolean
  onClose: () => void
  title: string
  caption?: string
  video: boolean
  /** The output opened, resolved here the way the frame resolved it. */
  output: MediaOutput | null
}) {
  const src = useMediaSource(output, video)
  const poster = output?.poster
  // Raised above the dialog layer: a lightbox can be opened from inside one.
  return (
    <Overlay open={open} onClose={onClose} raised className="p-8">
      <motion.div
        role="dialog"
        aria-modal
        aria-label={title}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        // Leaves in the scrim's own time and ease, so the two halves of the
        // dismissal are the same length; see `Dialog` for the mismatch this
        // replaces.
        exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.base, ease: EASE_IN } }}
        transition={SPRING_SURFACE}
        // Three quarters of the window, and no more than the media needs.
        // `max-height` matters as much as width: without it a portrait clip
        // in a short window overflows the viewport and the caption goes
        // somewhere you cannot reach.
        className="flex w-[75vw] max-w-[1100px] flex-col rounded-block bg-surface-raised p-2 shadow-modal"
        style={{ maxHeight: '82vh' }}
      >
        {/* The panel's own surface, not black. Black was the default the player
            painted and it showed as a band wherever the clip's ratio did
            not match the frame — which is most of the time, and which
            read as the video escaping the rounded shape. */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-block-inner bg-code-surface">
          {video && src ? (
            // The player's chrome is a chunk of its own: most sessions never
            // open a video. While it arrives the poster stands where the
            // frame will be, dimmed, so the box does not jump when the
            // controls land; with no poster, the app's one wait.
            <Deferred
              label="Video player"
              {...(poster
                ? {
                    fallback: (
                      <span aria-hidden className="block size-full bg-selected">
                        <img src={poster} alt="" className="size-full object-contain opacity-60" />
                      </span>
                    ),
                  }
                : {})}
            >
              <VideoPlayer src={src} poster={poster} title={title} autoPlay />
            </Deferred>
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
              <Icons.close size="sm" />
            </IconButton>
          </span>
        </div>
      </motion.div>
    </Overlay>
  )
}
