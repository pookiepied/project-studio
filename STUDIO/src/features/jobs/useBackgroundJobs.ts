import { useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspace } from '@/stores/workspace'
import type { BackgroundJob } from '@/platform/harness'

/**
 * How often the jobs are read while any of them is still running.
 *
 * Faster than the plan's active cadence, because what this shows is a process
 * writing output. A dev server prints the port it bound and then goes quiet;
 * two seconds between reads is the difference between watching a build and
 * checking on one.
 */
const RUNNING_POLL_MS = 2_000

/**
 * How often they are read when nothing is running.
 *
 * Slow, but not zero: a job the model starts in the next turn should appear
 * without the panel having to be reopened.
 */
const IDLE_POLL_MS = 10_000

/**
 * One conversation's background commands, read on a poll.
 *
 * The same shape `usePlan` runs and deliberately not the same hook: a plan is
 * standing state a person edits, and these are live processes. The cadence
 * follows what is actually running rather than whether a turn is under way,
 * which is the difference that matters here - a download started three turns
 * ago is still writing output long after the run that began it ended.
 *
 * A failed read keeps the last known list. "The harness is not answering" is
 * not the same fact as "nothing is running", and blanking the panel on a
 * missed poll would say the second while meaning the first.
 */
export function useBackgroundJobs(
  conversationId: string,
  options: { readonly enabled?: boolean } = {},
): {
  readonly jobs: readonly BackgroundJob[]
  /** Whether anything is still running. Drives the cadence and the rail's mark. */
  readonly anyRunning: boolean
  /** While a stop is in flight, so the row's control can be disabled. */
  readonly stoppingId: string | null
  readonly error: string | null
  stop: (jobId: string) => Promise<void>
} {
  const { enabled = true } = options
  const currentScope = useRef(conversationId)
  currentScope.current = conversationId
  const { backgroundJobs } = useWorkspace()

  const [snapshot, setSnapshot] = useState<{ conversationId: string; jobs: readonly BackgroundJob[] }>({ conversationId, jobs: [] })
  const jobs = snapshot.conversationId === conversationId ? snapshot.jobs : []
  const [error, setError] = useState<string | null>(null)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const anyRunning = jobs.some((job) => job.state === 'running' || job.state === 'stopping')

  const read = useCallback(async (current: () => boolean) => {
    try {
    const result = await backgroundJobs.list(conversationId)
    if (!liveRef.current || !current()) return
    if (!result.ok) { setError('Background work could not be refreshed. Showing the last known state.'); return }
    setError(null)
    setSnapshot((previous) => previous.conversationId === conversationId && previous.jobs === result.value ? previous : { conversationId, jobs: result.value })
    } catch {
      if (liveRef.current && current() && currentScope.current === conversationId) setError('Background work could not be refreshed. Showing the last known state.')
    }
  }, [backgroundJobs, conversationId])

  // A per-conversation read must not show the previous conversation's
  // processes across a switch, and here that is not merely untidy: the panel
  // offers a stop button per row.
  useEffect(() => {
    setError(null)
  }, [conversationId])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = () => {
      void read(() => !disposed).then(() => {
        if (liveRef.current && !disposed) {
          timer = setTimeout(poll, anyRunning ? RUNNING_POLL_MS : IDLE_POLL_MS)
        }
      })
    }
    poll()
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [enabled, anyRunning, read])

  const stop = useCallback(
    async (jobId: string) => {
      if (currentScope.current !== conversationId) return
      setStoppingId(jobId)
      try {
        const result = await backgroundJobs.stop(conversationId, jobId)
        if (currentScope.current !== conversationId) return
        // Only an accepted stop writes the row locally. A refusal is left for
        // the next poll, which also catches another window having stopped the
        // same job first.
        if (result.ok && liveRef.current) {
          const stopped = result.value
          if (stopped) setSnapshot((current) => current.conversationId !== conversationId ? current : {
            conversationId, jobs: current.jobs.map((job) => job.id === jobId ? stopped : job),
          })
        }
        if (!result.ok && liveRef.current) setError('The stop request failed. Try again.')
      } catch {
        if (liveRef.current && currentScope.current === conversationId) setError('The stop request failed. Try again.')
      } finally {
        if (liveRef.current) setStoppingId(null)
      }
    },
    [backgroundJobs, conversationId],
  )

  return { jobs, anyRunning, stoppingId, stop, error }
}
