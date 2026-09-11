import { useEffect, useState } from 'react'

import { Icons } from '@/components/icons'
import { harnessBytesDataUrl, pictureMime, type MediaJob } from '@/platform/harness'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'
import type { MediaArtifact, MediaCallView } from './mediaCall'

/**
 * A generation call, shown as the thing it made.
 *
 * An image call answers with its picture, and the picture is the point: it
 * is drawn here rather than parked behind a disclosure, at the width of the
 * transcript, with the prompt beneath as a caption. A video call answers
 * with a job id before any file exists, so the card follows the job through
 * the media routes - a poll every few seconds while it runs - and draws the
 * player when the file lands, or the vendor's sentence when it does not.
 *
 * The bytes are the harness's, fetched through the same resolver the browser
 * frames use and shown from a `data:` URL, so a picture on another device
 * arrives through the paired listener like everything else. No file is
 * written on this side and no vendor URL is ever known to it.
 */

export function MediaCard({
  view,
  conversationId,
  failed,
  running,
}: {
  view: MediaCallView
  conversationId: string
  /** The call itself was refused or failed. */
  failed: string | null
  /** The call has not answered yet. */
  running: boolean
}) {
  const job = useFollowedJob(conversationId, view.kind === 'video' ? view.jobId : null)
  const artifacts: readonly MediaArtifact[] =
    view.artifacts.length > 0
      ? view.artifacts
      : job?.state === 'done'
        ? job.outputs.map((output) => ({
            path: `/api/media/artifacts/${conversationId}/${output.fileName}`,
            mimeType: output.mimeType,
          }))
        : []
  const jobFailed = job !== null && (job.state === 'failed' || job.state === 'stopped')
  const working = !failed && !jobFailed && artifacts.length === 0 && (running || job === null || job.state === 'queued' || job.state === 'running')
  const sentence =
    failed ??
    (jobFailed
      ? job.state === 'stopped'
        ? 'The generation was stopped.'
        : (job.error ?? 'The generation failed.')
      : null)

  return (
    <div className="flex flex-col gap-1.5">
      {artifacts.length > 0 ? (
        <div className={cn('grid gap-2', artifacts.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {artifacts.map((artifact) => (
            <Output key={artifact.path} artifact={artifact} kind={view.kind} prompt={view.prompt} />
          ))}
        </div>
      ) : working ? (
        <Working kind={view.kind} detail={job?.detail ?? null} />
      ) : null}

      {sentence === null ? null : (
        <p className="studio-selectable text-caption text-danger">{sentence}</p>
      )}

      {view.prompt === null ? null : (
        <p className="studio-selectable text-caption text-muted-foreground">{view.prompt}</p>
      )}
    </div>
  )
}

function Output({
  artifact,
  kind,
  prompt,
}: {
  artifact: MediaArtifact
  kind: 'image' | 'video'
  prompt: string | null
}) {
  const url = useHarnessBytes(artifact.path, kind === 'image' ? pictureMime(artifact.mimeType) : videoMime(artifact.mimeType))
  if (url === null) return <Working kind={kind} detail={null} />
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      {kind === 'video' ? (
        // Native controls: a transcript is not the place for a player of our
        // own, and the browser's controls already work with every input.
        <video src={url} controls playsInline preload="metadata" className="w-full" />
      ) : (
        <img
          src={url}
          alt={prompt ?? 'A generated image'}
          className="w-full object-contain"
          draggable={false}
        />
      )}
    </div>
  )
}

function Working({ kind, detail }: { kind: 'image' | 'video'; detail: string | null }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-tint px-3 py-2 text-caption text-muted-foreground"
      // The frame reserves a picture's height so the finished output drops
      // into a space already the right size, rather than shoving the
      // transcript down by a whole image the moment it arrives.
      style={{ aspectRatio: '4 / 3' }}
    >
      <Icons.generate size="sm" />
      <span>{detail ?? (kind === 'video' ? 'This takes a few minutes.' : 'This can take a minute.')}</span>
    </div>
  )
}

/** The mime a `<video>` may be handed; anything else is shown as mp4. */
function videoMime(mimeType: string): string {
  return /^video\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'video/mp4'
}

function useHarnessBytes(path: string, mimeType: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    void harnessBytesDataUrl(path, mimeType).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [path, mimeType])
  return url
}

/** How often a running video job is asked after. */
const FOLLOW_INTERVAL_MS = 5_000

/**
 * The job a video call started, followed until it ends.
 *
 * Null while there is nothing to follow, or before the first answer; the
 * card shows "generating" for both, which is the truth in both. Polling
 * stops the moment the job has ended, and on unmount.
 */
function useFollowedJob(conversationId: string, jobId: string | null): MediaJob | null {
  const { mediaJobs } = useWorkspace()
  const [job, setJob] = useState<MediaJob | null>(null)

  useEffect(() => {
    if (jobId === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const ask = async () => {
      const result = await mediaJobs.list(conversationId)
      if (cancelled) return
      const found = result.ok ? (result.value.find((candidate) => candidate.id === jobId) ?? null) : null
      setJob(found)
      // The registry is in memory: a job it does not know - one from before
      // a restart - will never appear, so asking again would be forever. A
      // harness that could not be reached is asked again.
      if (result.ok && found === null) return
      const ended = found !== null && (found.state === 'done' || found.state === 'failed' || found.state === 'stopped')
      if (!ended) timer = setTimeout(() => void ask(), FOLLOW_INTERVAL_MS)
    }
    void ask()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [conversationId, jobId, mediaJobs])

  return job
}
