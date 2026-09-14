import { useEffect, useState } from 'react'

import { MediaArtifact } from '@/features/artifacts/kinds/MediaArtifact'
import { useWorkspace } from '@/stores/workspace'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { mediaCallArtifact, type FollowedJob, type MediaCallView } from './mediaCall'

/**
 * A generation call, drawn as the artifact it is.
 *
 * The same component the gallery's fence lands in draws the real thing, so
 * what a generated picture looks like is decided once. This file only
 * supplies what a fence cannot: the job a video call started, followed
 * through the media routes - a poll every few seconds while it runs - until
 * its file lands, or the vendor's sentence when it does not.
 */
export function MediaCallArtifact({
  call,
  view,
  conversationId,
}: {
  call: ToolCallView
  view: MediaCallView
  conversationId: string
}) {
  const job = useFollowedJob(conversationId, view.kind === 'video' ? view.jobId : null)
  const artifact = mediaCallArtifact(call, view, job, conversationId)
  return <MediaArtifact artifact={artifact} video={view.kind === 'video'} />
}

/** How often a running video job is asked after. */
const FOLLOW_INTERVAL_MS = 5_000

/**
 * The job a video call started, followed until it ends.
 *
 * Null while there is nothing to follow, or before the first answer; the
 * artifact shows "generating" for both, which is the truth in both. Polling
 * stops the moment the job has ended, and on unmount.
 */
function useFollowedJob(conversationId: string, jobId: string | null): FollowedJob {
  const { mediaJobs } = useWorkspace()
  const [job, setJob] = useState<FollowedJob>(null)

  useEffect(() => {
    if (jobId === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const ask = async () => {
      const result = await mediaJobs.list(conversationId)
      if (cancelled) return
      const found = result.ok ? (result.value.find((candidate) => candidate.id === jobId) ?? null) : null
      // The registry is in memory: a job it does not know - one from before
      // a restart - will never appear, so asking again would be forever. A
      // harness that could not be reached is asked again.
      if (result.ok && found === null) {
        setJob('unknown')
        return
      }
      setJob(found)
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
