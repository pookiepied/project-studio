import { useState, type ReactNode } from 'react'
import { Arrive } from '@/components/motion/Arrive'
import { Icons } from '@/components/icons'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import { MediaLightbox } from '@/features/artifacts/media/MediaLightbox'
import { MediaGrid } from '@/features/artifacts/media/MediaGrid'
import { useMediaViewerHost } from '@/features/artifacts/media/edits'
import { Timeline } from '@/features/artifacts/sections'
import { mediaOf, type MediaOutput } from '@/domain/artifacts/media'
import { isWorking, type Artifact } from '@/domain/artifacts/types'
import { cn } from '@/lib/cn'

/**
 * Generated media — an image or a video.
 *
 * One component for both, because the difference is the element in the frame
 * and nothing else: identical status vocabulary, identical prompt, identical
 * progress steps, identical aspect handling.
 *
 * ---- A row, then the pictures ----------------------------------------------
 *
 * The picture is the message (design/RULES §9, "independent"), so it stands
 * in the reply as itself: no card around it, no title over it, no caption
 * under it. What used to be the card's header is one quiet row in the shape
 * of every other row of a turn - the medium's mark, then what happened -
 * and the prompt hangs under that row when it is opened, the way a thought's
 * trace and the person's answers do. Then the frames, each the shape of its
 * picture, under one height (`MediaGrid`).
 *
 * `held` draws the same row and frames inside a soft rounded holder: the
 * earlier design, kept as an option while Family A's is judged against it.
 *
 * ---- One line of status ---------------------------------------------------
 *
 * While it runs: "Generating image", or the vendor's own word when it gives
 * one ("Rendering"), then the model. When it is done: the medium and how
 * many, then the model. When it failed: the harness's sentence, verbatim, in
 * the danger colour, and no frames - a box saying "failed" under a line
 * saying why is the same fact drawn twice. When it was stopped: "stopped", in
 * the row's own grey, because stopping is a choice and not a fault.
 */
export function MediaArtifact({
  artifact,
  video,
  onKeep,
  held = false,
}: {
  artifact: Artifact
  video: boolean
  /**
   * "Keep in the library", offered over a finished picture when the
   * caller can file it: the transcript's card can, a gallery cannot.
   */
  onKeep?: (output: MediaOutput, index: number) => void
  /** Inside a rounded holder, as the earlier design drew it. */
  held?: boolean
}) {
  const media = mediaOf(artifact.data)
  const working = isWorking(artifact.status)
  const failed = artifact.status === 'failed'
  const stopped = artifact.status === 'cancelled'
  const [open, setOpen] = useState<number | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const timeline = artifact.sections?.find((section) => section.type === 'timeline')

  const noun = video ? 'video' : 'image'
  const ready = media.outputs.length
  const status = statusLine({ noun, working, failed, stopped, ready, detail: media.detail, error: media.error })

  const host = useMediaViewerHost()
  const opened = open === null ? null : media.outputs[open] ?? null
  const titleAt = (index: number) =>
    media.outputs.length > 1
      ? `${artifact.title} (${String(index + 1)} of ${String(media.outputs.length)})`
      : artifact.title
  const openTitle = open === null ? artifact.title : titleAt(open)
  const mark: ReactNode = working ? <Icons.generate /> : video ? <Icons.video /> : <Icons.image />
  const showFrames = !(failed || stopped) || media.outputs.length > 0

  return (
    <Arrive
      className={cn(
        'my-4 flex w-full min-w-0 flex-col',
        held && 'rounded-[20px] bg-surface-sunken p-3',
      )}
    >
      <DisclosureRow
        leading={mark}
        label={
          <span className={cn('min-w-0 truncate', working && 'studio-shimmer', failed && 'text-danger')}>
            {status}
          </span>
        }
        open={promptOpen}
        onToggle={() => setPromptOpen((value) => !value)}
        chevron="hover"
        hang
      >
        {/* What was asked for: the prompt, or the title when the prompt is
            the title (the transcript names a call by its prompt). */}
        <p className="studio-selectable text-muted-foreground">{media.prompt ?? artifact.title}</p>
      </DisclosureRow>

      {showFrames ? (
        <div className="mt-2 min-w-0">
          <MediaGrid
            outputs={media.outputs}
            expected={working ? media.expected : media.outputs.length}
            ratio={media.ratio}
            video={video}
            title={artifact.title}
            working={working}
            onOpen={(index) => {
              const output = media.outputs[index]
              // The page that hosts the viewer opens it over its transcript,
              // with the composer kept; anywhere else the frame opens its own.
              if (host === null || output === undefined) {
                setOpen(index)
                return
              }
              host.open({
                output,
                title: titleAt(index),
                model: media.model,
                video,
                ...(!video && onKeep !== undefined ? { onKeep: () => onKeep(output, index) } : {}),
              })
            }}
            {...(!video && !working && onKeep !== undefined ? { onKeep } : {})}
          />
        </div>
      ) : null}

      {host === null ? (
        <MediaLightbox
          output={opened}
          open={open !== null && opened !== null}
          onClose={() => setOpen(null)}
          title={openTitle}
          model={media.model}
          video={video}
          {...(!video && opened !== null && open !== null && onKeep !== undefined
            ? { onKeep: () => onKeep(opened, open) }
            : {})}
        />
      ) : null}

      {timeline?.type === 'timeline' ? (
        <div className="mt-3">
          <Timeline items={timeline.items} />
        </div>
      ) : null}
    </Arrive>
  )
}

/** The row's words: what is happening, or what happened. */
export function statusLine({
  noun,
  working,
  failed,
  stopped,
  ready,
  detail,
  error,
}: {
  noun: 'image' | 'video'
  working: boolean
  failed: boolean
  stopped: boolean
  ready: number
  detail: string | null | undefined
  error: string | null | undefined
}): string {
  const Noun = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`
  if (failed) return error ?? `The ${noun} could not be generated`
  // A stop can carry its own reason - "started before Studio last
  // restarted, so its result was not kept" - and that reason is the line.
  if (stopped) return error ?? `${Noun} stopped`
  // The model is not on the row: it was the longest thing there
  // ("qwen/qwen-image-2.1-turbo") and the least read. It stays in the
  // viewer, beside the prompt, for whoever wants to know.
  if (working) return detail ?? `Generating ${noun}`
  return ready > 1 ? `${String(ready)} ${noun}s` : Noun
}
