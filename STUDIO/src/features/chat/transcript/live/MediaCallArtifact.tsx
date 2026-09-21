import { useEffect, useState } from 'react'
import { KeepDialog } from '@/features/library/KeepDialog'
import { base64OfDataUrl, type KeepCandidate } from '@/features/library/client'
import { harnessBytesDataUrl } from '@/platform/harness'

import { MediaArtifact } from '@/features/artifacts/kinds/MediaArtifact'
import { useWorkspace } from '@/stores/workspace'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { artifactPath, mediaCallArtifact, type FollowedJob, type MediaArtifactRef, type MediaCallView } from './mediaCall'

/**
 * A generation call, drawn as the artifact it is.
 *
 * The same component the gallery's fence lands in draws the real thing, so
 * what a generated picture looks like is decided once. This file only
 * supplies what a fence cannot: the job a video call started, followed
 * through the media routes - a poll every few seconds while it runs - until
 * its file lands, or the vendor's sentence when it does not. A job the
 * harness no longer holds - one from before a restart - is answered from the
 * conversation's artifacts instead, which is the record that outlived it.
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
  const jobId = view.kind === 'video' ? view.jobId : null
  const job = useFollowedJob(conversationId, jobId)
  const recovered = useRecoveredOutputs(conversationId, jobId, job === 'unknown')
  const artifact = mediaCallArtifact(call, view, job, conversationId, recovered)
  const [keeping, setKeeping] = useState<KeepCandidate | null>(null)

  // A generated picture is a harness path; the library takes bytes, so the
  // same fetch the frame drew it with hands them over.
  const keep = async (path: string, mimeType: string) => {
    const url = await harnessBytesDataUrl(path, mimeType)
    if (url === null) return
    setKeeping({
      fileName: path.slice(path.lastIndexOf('/') + 1),
      mimeType,
      data: base64OfDataUrl(url),
      sourceConversationId: conversationId,
    })
  }

  return (
    <>
      <MediaArtifact
        artifact={artifact}
        video={view.kind === 'video'}
        onKeep={(output) => {
          if (output.path === undefined) return
          void keep(output.path, output.mimeType ?? 'image/png')
        }}
      />
      <KeepDialog open={keeping !== null} candidate={keeping} editing={null} onClose={() => setKeeping(null)} />
    </>
  )
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

/**
 * The outputs a forgotten job left, as the conversation's artifacts directory
 * still answers them.
 *
 * Asked once, when the registry has said the job is not its: a finished
 * output never changes, so what the directory holds for this job's id is
 * final. Neither is a harness that could not be asked re-asked here - the
 * follow already owns that question, and a card that could not reach it has
 * the not-kept sentence to show.
 */
function useRecoveredOutputs(
  conversationId: string,
  jobId: string | null,
  forgotten: boolean,
): readonly MediaArtifactRef[] {
  const { mediaJobs } = useWorkspace()
  const [recovered, setRecovered] = useState<readonly MediaArtifactRef[]>([])

  useEffect(() => {
    if (jobId === null || !forgotten) return
    let cancelled = false
    void mediaJobs.artifacts(conversationId).then((result) => {
      if (cancelled || !result.ok) return
      // A listing answers only the names the job registry writes - the job's
      // own id, then its output's -<index>.<extension> - so the id before
      // the first dash is the whole ownership question.
      setRecovered(
        result.value
          .filter((file) => file.fileName.startsWith(`${jobId}-`))
          .map((file) => ({
            path: artifactPath(conversationId, file.fileName),
            mimeType: file.mimeType,
          })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, jobId, forgotten, mediaJobs])

  return recovered
}
