import type { SyntheticEvent } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { BobbingDots, Deferred, lazyNamed } from '@/components/state'
import { useMediaSource } from '@/features/artifacts/media/source'
import type { MediaOutput } from '@/domain/artifacts/media'
import { cn } from '@/lib/cn'

const VideoPlayer = lazyNamed(
  () => import('@/features/artifacts/media/VideoPlayer'),
  'VideoPlayer',
)

/**
 * One generated picture or clip, in every state it passes through.
 *
 * The frame exists before the file does. It is reserved at the ratio the
 * call asked for and holds the medium's mark with the app's one wait bobbing
 * under it; when the bytes land the picture fades in over the same box, and
 * the box takes the picture's real ratio — which is usually the reserved one,
 * and when it is not, the correction happens once, at the moment the eye is
 * already on the change.
 *
 * ---- The field is neutral -------------------------------------------------
 *
 * Deliberately not a coloured gradient standing in for the picture. A tinted
 * rectangle where an image will be reads as a *failed* image, and worse, it
 * sets an expectation about the colours of something that has not been made
 * yet. A neutral field holding the medium's icon predicts nothing.
 *
 * ---- Where the bytes come from ------------------------------------------
 *
 * A gallery output is a URL and is shown as one. A generated output is a path
 * the harness serves, fetched through the same resolver the browser frames
 * use and shown from a `data:` URL, so a picture on another device arrives
 * through the paired listener like everything else. No file is written on
 * this side and no vendor URL is ever known to it.
 */
export function MediaFrame({
  output,
  video,
  title,
  working,
  ratio,
  onRatio,
  onOpen,
}: {
  /** The output, or null for a frame reserved for one still coming. */
  output: MediaOutput | null
  video: boolean
  title: string
  /** The artifact is still generating: the wait bobs in an empty frame. */
  working: boolean
  /** The ratio the grid has given this frame; it sizes the box. */
  ratio: number
  /** The picture's real ratio, once it can be measured. */
  onRatio: (ratio: number) => void
  /** Open this output larger. Absent while there is nothing to open. */
  onOpen?: () => void
}) {
  const src = useMediaSource(output, video)
  const poster = output?.poster
  // A finished video whose file has not landed yet still has a poster, which
  // is a real frame of it and beats a placeholder.
  const shown = src ?? (video ? null : poster ?? null)

  const measured = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      onRatio(image.naturalWidth / image.naturalHeight)
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-block-inner bg-selected"
      // The aspect ratio is reserved *before* the media exists, so the
      // finished frame drops into a space already the right size. Without it
      // the transcript jumps by the height of an image the moment one
      // resolves, which is the single most visible layout shift in a chat.
      style={{ aspectRatio: String(ratio) }}
    >
      {shown === null ? (
        <Waiting active={working || output !== null} video={video} />
      ) : video ? (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          {/* The player's chrome is a chunk of its own: most sessions never
              open a video. While it arrives the poster stands where the
              frame will be, dimmed, so the box does not jump when the
              controls land; with no poster, the app's one wait. */}
          <Deferred
            label="Video player"
            fallback={
              poster ? (
                <span aria-hidden className="block size-full">
                  <img src={poster} alt="" className="size-full object-cover opacity-60" />
                </span>
              ) : (
                <Waiting active video={video} />
              )
            }
          >
            <VideoPlayer src={shown} poster={poster} title={title} onRatio={onRatio} />
          </Deferred>
        </motion.div>
      ) : (
        <motion.img
          src={shown}
          alt={title}
          draggable={false}
          onLoad={measured}
          className="absolute inset-0 size-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        />
      )}

      {/* A picture is opened by clicking it - the whole frame is the target,
          not a small button in the corner of it - and the glyph appears
          under the pointer to say so. A clip plays where it is, so its
          frame belongs to the player; the same glyph sits in the corner
          instead, out of the way of the play control. */}
      {onOpen !== undefined && shown !== null ? (
        video ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${title} larger`}
            className={cn(
              'group/open absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full outline-none',
              'bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity duration-base',
              'hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
              '[&_.studio-icon]:text-white',
            )}
          >
            <Icons.openLarger size="sm" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${title}`}
            className="group/media absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className="absolute inset-0 bg-black/0 transition-colors duration-base group-hover/media:bg-black/15" />
            <span
              className={cn(
                // `text-white` alone does not reach the mark: `.studio-icon`
                // holds every glyph at `--muted-foreground` so a mark never
                // darkens with the row it sits in, and a grey glyph on a dark
                // scrim over a picture is unreadable rather than quiet. The
                // arbitrary variant lands in the utilities layer and wins, the
                // same way the solid `IconButton` opts out.
                'relative flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm [&_.studio-icon]:text-white',
                'opacity-0 transition-opacity duration-base group-hover/media:opacity-100 group-focus-visible/media:opacity-100',
              )}
            >
              <Icons.openLarger />
            </span>
          </button>
        )
      ) : null}
    </div>
  )
}

/**
 * The frame while there is nothing to show in it: the medium's mark, and
 * the app's one wait bobbing under it for as long as something is coming.
 */
function Waiting({ active, video }: { active: boolean; video: boolean }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
    >
      <span className="text-muted-foreground/60">
        {video ? <Icons.video /> : <Icons.image />}
      </span>
      {active ? <BobbingDots size={4} className="text-muted-foreground/60" /> : null}
    </span>
  )
}

