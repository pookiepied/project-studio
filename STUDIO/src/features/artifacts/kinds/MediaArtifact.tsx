import { useState } from 'react'
import { Icons } from '@/components/icons'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { MediaLightbox } from '@/features/artifacts/media/MediaLightbox'
import { MediaGrid } from '@/features/artifacts/media/MediaGrid'
import { Timeline } from '@/features/artifacts/sections'
import { mediaOf } from '@/domain/artifacts/media'
import { isWorking, type Artifact } from '@/domain/artifacts/types'
import { cn } from '@/lib/cn'

/**
 * Generated media — an image or a video.
 *
 * One component for both, because the difference is the element in the frame
 * and nothing else: identical status vocabulary, identical prompt, identical
 * progress steps, identical aspect handling. Two files here would be two files
 * to keep in sync forever over one `<img>` versus one `<video>`.
 *
 * ---- The frames are the artifact ------------------------------------------
 *
 * The shell says what is happening; the frames are what happened. A call
 * that asks for four pictures shows four frames from the first moment, each
 * reserved at the ratio asked for, and each fills in as its file lands. The
 * prompt is the caption under all of them, once, because it made all of
 * them; the progress steps, when the artifact carries any, sit under that.
 *
 * ---- One line of status ---------------------------------------------------
 *
 * While it runs: "Generating", then the vendor's own word when it gives one
 * ("Rendering frames"), then the model. When it is done: what is ready, and
 * how many. When it failed: the harness's sentence, verbatim, in the shell's
 * failed register — the frames stay out of it, because a box saying
 * "failed" under a line saying why is the same fact drawn twice.
 */
export function MediaArtifact({ artifact, video }: { artifact: Artifact; video: boolean }) {
  const media = mediaOf(artifact.data)
  const working = isWorking(artifact.status)
  const failed = artifact.status === 'failed'
  const ended = failed || artifact.status === 'cancelled'
  const [open, setOpen] = useState<number | null>(null)
  const timeline = artifact.sections?.find((section) => section.type === 'timeline')

  const noun = video ? 'video' : 'image'
  const ready = media.outputs.length
  const status = ended
    ? media.error ?? (failed ? `The ${noun} could not be generated` : 'Stopped')
    : [
        working
          ? media.detail ?? 'Generating'
          : ready > 1
            ? `${String(ready)} ${noun}s ready`
            : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ready`,
        media.model,
      ]
        .filter(Boolean)
        .join(' · ')

  const opened = open === null ? null : media.outputs[open] ?? null
  const openTitle =
    open !== null && media.outputs.length > 1
      ? `${artifact.title} (${String(open + 1)} of ${String(media.outputs.length)})`
      : artifact.title

  return (
    <ArtifactShell
      artifact={artifact}
      mark={working ? <Icons.generate /> : video ? <Icons.video /> : <Icons.image />}
      status={status}
      rail={false}
    >
      {failed && media.outputs.length === 0 ? null : (
        <MediaGrid
          outputs={media.outputs}
          expected={working ? media.expected : media.outputs.length}
          ratio={media.ratio}
          video={video}
          title={artifact.title}
          working={working}
          onOpen={(index) => setOpen(index)}
        />
      )}

      <MediaLightbox
        output={opened}
        open={open !== null && opened !== null}
        onClose={() => setOpen(null)}
        title={openTitle}
        caption={media.prompt}
        video={video}
      />

      {media.prompt ? <Prompt text={media.prompt} /> : null}

      {timeline?.type === 'timeline' ? (
        <div className="mt-3">
          <Timeline items={timeline.items} />
        </div>
      ) : null}
    </ArtifactShell>
  )
}


/**
 * The prompt, one line of it.
 *
 * A prompt to an image model runs to a paragraph, and the whole of it under
 * every picture made the card mostly words about a picture that is right
 * there. One line, cut with an ellipsis, says what was asked; the line
 * opens to the whole on a click, for the reader who wants the wording.
 */
function Prompt({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      className={cn(
        'mt-2.5 block w-full min-w-0 text-left text-caption text-muted-foreground outline-none',
        'rounded-md focus-visible:ring-2 focus-visible:ring-ring',
        open ? '' : 'truncate',
      )}
    >
      <span className="font-medium text-foreground">Prompt </span>
      {text}
    </button>
  )
}
