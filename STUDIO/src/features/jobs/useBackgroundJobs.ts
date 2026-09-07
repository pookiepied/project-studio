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
  stop: (jobId: string) => Promise<void>
} {
  const { enabled = true } = options
  const { backgroundJobs } = useWorkspace()

  const [jobs, setJobs] = useState<readonly BackgroundJob[]>([])
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const anyRunning = jobs.some((job) => job.state === 'running')

  const read = useCallback(async () => {
    const result = await backgroundJobs.list(conversationId)
    if (!result.ok || !liveRef.current) return
    setJobs(result.value)
  }, [backgroundJobs, conversationId])

  // A per-conversation read must not show the previous conversation's
  // processes across a switch, and here that is not merely untidy: the panel
  // offers a stop button per row.
  useEffect(() => {
    setJobs([])
  }, [conversationId])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = () => {
      void read().then(() => {
        if (liveRef.current) {
          timer = setTimeout(poll, anyRunning ? RUNNING_POLL_MS : IDLE_POLL_MS)
        }
      })
    }
    poll()
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [enabled, anyRunning, read])

  const stop = useCallback(
    async (jobId: string) => {
      setStoppingId(jobId)
      try {
        const result = await backgroundJobs.stop(conversationId, jobId)
        // Only an accepted stop writes the row locally. A refusal is left for
        // the next poll, which also catches another window having stopped the
        // same job first.
        if (result.ok && liveRef.current) {
          const stopped = result.value
          setJobs((current) =>
            current.map((job) =>
              job.id === jobId ? (stopped ?? { ...job, state: 'stopped' as const }) : job,
            ),
          )
        }
      } finally {
        if (liveRef.current) setStoppingId(null)
      }
    },
    [backgroundJobs, conversationId],
  )

  return { jobs, anyRunning, stoppingId, stop }
}
