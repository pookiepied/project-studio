import { useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { BobbingDots } from '@/components/state'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { MediaLightbox } from '@/features/artifacts/media'
import { Timeline } from '@/features/artifacts/sections'
import { isWorking, type Artifact } from '@/domain/artifacts/types'
import { cn } from '@/lib/cn'

/**
 * Generated media — an image or a video.
 *
 * One component for both, because the difference is the element in the frame
 * and nothing else: identical status vocabulary, identical prompt, identical
 * progress steps, identical aspect handling. Two files here would be two files
 * to keep in sync forever over one `<img>` versus one `<video>`.
 */
interface MediaData {
  readonly prompt?: string
  readonly url?: string
  readonly poster?: string
  readonly aspectRatio?: string
  readonly model?: string
}

export function MediaArtifact({ artifact, video }: { artifact: Artifact; video: boolean }) {
  const data = (artifact.data ?? {}) as MediaData
  const working = isWorking(artifact.status)
  const [open, setOpen] = useState(false)

  // Whatever there is to show. A finished video whose file has not landed yet
  // still has a poster, which is a real frame of it and beats a placeholder.
  const still = data.url ?? data.poster
  const openable = !working && Boolean(still)
  const timeline = artifact.sections?.find((section) => section.type === 'timeline')

  const detail = [working ? 'Generating' : video ? 'Video ready' : 'Image ready', data.model]
    .filter(Boolean)
    .join(' · ')

  return (
    <ArtifactShell
      artifact={artifact}
      mark={working ? <Icons.generate /> : video ? <Icons.video /> : <Icons.image />}
      status={detail}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="relative overflow-hidden rounded-block-inner"
        // The aspect ratio is reserved *before* the media exists, so the
        // finished frame drops into a space already the right size. Without it
        // the transcript jumps by the height of an image the moment one
        // resolves, which is the single most visible layout shift in a chat.
        style={{ aspectRatio: data.aspectRatio ?? '4 / 3' }}
      >
        {still && !working ? (
          <img src={still} alt={artifact.title} className="size-full object-cover" />
        ) : (
          <Frame active={working} video={video} />
        )}

        {/* The whole frame is the target, not a small button in the corner of
            it. Clicking a picture to see it bigger is the gesture everyone
            already has; a video plays here rather than in place, because a
            control bar under a 200px-tall clip in a transcript is four tiny
            targets nobody can hit. */}
        {openable ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={video ? `Play ${artifact.title}` : `Open ${artifact.title}`}
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
                'relative flex items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm [&_.studio-icon]:text-white',
                'transition-transform duration-base group-hover/media:scale-105',
                video ? 'size-12' : 'size-9 opacity-0 group-hover/media:opacity-100',
              )}
            >
              {video ? <Icons.play size="lg" /> : <Icons.openLarger />}
            </span>
          </button>
        ) : null}
      </motion.div>

      <MediaLightbox
        open={open}
        onClose={() => setOpen(false)}
        title={artifact.title}
        caption={data.prompt}
        video={video}
        src={data.url ?? data.poster}
        poster={data.poster}
      />

      {data.prompt ? (
        <p className="mt-2.5 text-caption text-muted-foreground">
          <span className="font-medium text-foreground">Prompt </span>
          {data.prompt}
        </p>
      ) : null}

      {timeline?.type === 'timeline' ? (
        <div className="mt-3">
          <Timeline items={timeline.items} />
        </div>
      ) : null}
    </ArtifactShell>
  )
}

/**
 * The frame while it renders.
 *
 * Deliberately not a coloured gradient standing in for the picture. A tinted
 * rectangle where an image will be reads as a *failed* image, and worse, it
 * sets an expectation about the colours of something that has not been made
 * yet. A neutral field holding the medium's icon predicts nothing, and while
 * the model is still working the app's one wait bobs under the icon.
 * The field used to carry a travelling sweep - the first skeleton in the
 * app, and the last to go.
 */
function Frame({ active, video }: { active: boolean; video: boolean }) {
  return (
    <span aria-hidden className="flex size-full flex-col items-center justify-center gap-2 bg-selected">
      <span className="text-muted-foreground/60">
        {video ? <Icons.video /> : <Icons.image />}
      </span>
      {active ? <BobbingDots size={4} className="text-muted-foreground/60" /> : null}
    </span>
  )
}
