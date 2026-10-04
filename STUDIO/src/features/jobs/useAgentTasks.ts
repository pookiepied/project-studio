import { useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspace } from '@/stores/workspace'
import type { AgentTask } from '@/platform/harness'

/**
 * How often the tasks are read while any of them is still running.
 *
 * The same cadence the background commands poll at, because the question the
 * panel answers is the same shape: something is under way, and the person is
 * watching for the moment that changed. Faster than the idle read, slower
 * than a stream - the news of an ending also arrives on its own through the
 * conversation, so the poll is the list's heartbeat, not the only courier.
 */
const RUNNING_POLL_MS = 2_000

/**
 * How often they are read when nothing is running.
 *
 * Slow, but not zero: a task the harness dispatches on the next turn should
 * appear without the panel having to be reopened.
 */
const IDLE_POLL_MS = 10_000

/**
 * The harness's dispatched agent tasks, read on a poll.
 *
 * The whole index, not a conversation's slice: the rows the harness indexes
 * name no conversation except their own business (a title is dispatched for
 * the conversation it names, but its row is the harness's, not the
 * conversation's), so the rail's one background-work entry shows everything
 * the harness has in flight or has settled.
 *
 * A failed read keeps the last known list. "The harness is not answering" is
 * not the same fact as "nothing is running", and blanking the panel on a
 * missed poll would say the second while meaning the first - the same rule
 * the commands' hook keeps.
 */
export function useAgentTasks(
  options: { readonly enabled?: boolean } = {},
): {
  readonly tasks: readonly AgentTask[]
  /** Whether anything is still running. Drives the cadence. */
  readonly anyRunning: boolean
  /** While a cancel is in flight, so the row's control can be disabled. */
  readonly cancellingId: string | null
  cancel: (taskId: string) => Promise<void>
} {
  const { enabled = true } = options
  const { tasks: tasksSurface } = useWorkspace()

  const [tasks, setTasks] = useState<readonly AgentTask[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const anyRunning = tasks.some((task) => task.status === 'running' || task.status === 'queued')

  const read = useCallback(async () => {
    const result = await tasksSurface.list()
    if (!result.ok || !liveRef.current) return
    setTasks(result.value)
  }, [tasksSurface])

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

  const cancel = useCallback(
    async (taskId: string) => {
      setCancellingId(taskId)
      try {
        const result = await tasksSurface.cancel(taskId)
        // An accepted cancel writes the row locally; a refusal - including
        // "it had already settled" - is left for the next poll, which also
        // catches another window having stopped the same task first.
        if (result.ok && liveRef.current) {
          const stopped = result.value
          setTasks((current) =>
            current.map((task) =>
              task.id === taskId
                ? stopped
                  ? { ...task, status: 'cancelled' as const, settledAt: Date.now() }
                  : task
                : task,
            ),
          )
        }
      } finally {
        if (liveRef.current) setCancellingId(null)
      }
    },
    [tasksSurface],
  )

  return { tasks, anyRunning, cancellingId, cancel }
}
