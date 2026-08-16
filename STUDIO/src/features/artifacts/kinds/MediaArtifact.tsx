import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { Timeline } from '@/features/artifacts/sections'
import { isWorking, type Artifact } from '@/domain/artifacts/types'

/**
 * Generated media -- an image or a video.
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
        className="overflow-hidden rounded-lg"
        // The aspect ratio is reserved *before* the media exists, so the
        // finished frame drops into a space already the right size. Without it
        // the transcript jumps by the height of an image the moment one
        // resolves, which is the single most visible layout shift in a chat.
        style={{ aspectRatio: data.aspectRatio ?? '4 / 3' }}
      >
        {!working && data.url ? (
          video ? (
            <video
              src={data.url}
              poster={data.poster}
              controls
              className="size-full bg-black object-cover"
            />
          ) : (
            <img src={data.url} alt={artifact.title} className="size-full object-cover" />
          )
        ) : (
          <Shimmer active={working} video={video} />
        )}
      </motion.div>

      {data.prompt ? (
        <p className="mt-2.5 text-caption leading-relaxed text-muted-foreground">
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
 * The placeholder while it renders.
 *
 * Deliberately not a coloured gradient standing in for the picture. A tinted
 * rectangle where an image will be reads as a *failed* image, and worse, it
 * sets an expectation about the colours of something that has not been made
 * yet. A neutral field with a slow sweep says "working" and predicts nothing.
 */
function Shimmer({ active, video }: { active: boolean; video: boolean }) {
  return (
    <div className="relative flex size-full items-center justify-center bg-selected">
      {active ? (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(110deg, transparent 20%, color-mix(in oklab, var(--foreground) 7%, transparent) 50%, transparent 80%)',
          }}
          animate={{ x: ['-60%', '60%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
        />
      ) : null}
      <span className="relative text-muted-foreground/60">
        {video ? <Icons.video /> : <Icons.image />}
      </span>
    </div>
  )
}
