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
 * Both the request and the projection restrict rows to their parent conversation.
 * Late responses cannot replace a newer conversation's activity.
 *
 * A failed read keeps the last known list. "The harness is not answering" is
 * not the same fact as "nothing is running", and blanking the panel on a
 * missed poll would say the second while meaning the first - the same rule
 * the commands' hook keeps.
 */
export function useAgentTasks(
  options: { readonly enabled?: boolean; readonly conversationId: string },
): {
  readonly tasks: readonly AgentTask[]
  /** Whether anything is still running. Drives the cadence. */
  readonly anyRunning: boolean
  /** While a cancel is in flight, so the row's control can be disabled. */
  readonly cancellingId: string | null
  readonly error: string | null
  isCancelling: (taskId: string) => boolean
  cancel: (taskId: string) => Promise<void>
} {
  const { enabled = true, conversationId } = options
  const currentScope = useRef(conversationId)
  currentScope.current = conversationId
  const { tasks: tasksSurface } = useWorkspace()

  const [tasks, setTasks] = useState<readonly AgentTask[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set())
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const anyRunning = tasks.some((task) => task.status === 'running' || task.status === 'queued')

  const read = useCallback(async (current: () => boolean = () => true) => {
    try {
    const result = await tasksSurface.list(conversationId)
    if (!liveRef.current || !current() || currentScope.current !== conversationId) return
    if (!result.ok) { setError('Agent activity could not be refreshed. Showing the last known state.'); return }
    setError(null)
    const next = result.value.filter((task) => task.parentConversationId === conversationId)
    setRequested((previous) => {
      const active = new Set(next.filter((task) => ['running', 'queued', 'waiting_for_user'].includes(task.status)).map((task) => task.id))
      const pending = new Set([...previous].filter((id) => active.has(id)))
      return pending.size === previous.size ? previous : pending
    })
    setTasks((previous) => previous.length === next.length && previous.every((task, index) => task === next[index]) ? previous : next)
    } catch {
      if (liveRef.current && current() && currentScope.current === conversationId) setError('Agent activity could not be refreshed. Showing the last known state.')
    }
  }, [tasksSurface, conversationId])

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

  const cancel = useCallback(
    async (taskId: string) => {
      if (!tasks.some((task) => task.id === taskId && task.parentConversationId === conversationId)) return
      setCancellingId(taskId)
      setRequested((current) => new Set(current).add(taskId))
      setCancelError(null)
      try {
        const result = await tasksSurface.cancel(taskId)
        if (currentScope.current !== conversationId) return
        // Acceptance records intent; only the next indexed settlement confirms termination.
        if ((!result.ok || !result.value) && liveRef.current) {
          setRequested((current) => { const next = new Set(current); next.delete(taskId); return next })
          if (!result.ok) setCancelError('The stop request failed. Try again.')
        }
        if (result.ok && liveRef.current) await read()
      } catch {
        if (liveRef.current && currentScope.current === conversationId) {
          setCancelError('The stop request failed. Try again.')
          setRequested((current) => { const next = new Set(current); next.delete(taskId); return next })
        }
      } finally {
        if (liveRef.current) setCancellingId(null)
      }
    },
    [tasksSurface, read, tasks, conversationId],
  )

  return { tasks: tasks.filter((task) => task.parentConversationId === conversationId), anyRunning, cancellingId, cancel, error: cancelError ?? error, isCancelling: (id) => requested.has(id) }
}
