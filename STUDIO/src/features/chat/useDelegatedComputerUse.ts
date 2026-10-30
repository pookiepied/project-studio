import { useEffect, useState } from 'react'
import { resolveHarnessAddress } from '@/platform/harness'
import { createRequester } from '@/platform/harness/client/request'
import { isRecord } from '@/lib/guards'

/** A task of this conversation that is driving the desktop right now. */
export interface DelegatedComputerUse {
  readonly id: string
  readonly agentName: string
  /** The voice task an inline delegate runs inside; cancelling it is what stops the delegate. */
  readonly owner?: string
}

const SETTLED = ['completed', 'failed', 'cancelled']

export function parseDelegatedComputerUse(value: unknown): DelegatedComputerUse[] {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return []
  return value.tasks.flatMap((row: unknown) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.agentName !== 'string' || typeof row.stage !== 'string') return []
    if (row.computer !== true || SETTLED.includes(row.stage)) return []
    return [{ id: row.id, agentName: row.agentName, ...(typeof row.owner === 'string' ? { owner: row.owner } : {}) }]
  })
}

/**
 * The delegates and voice tasks of one conversation that are using the
 * computer. Their tool calls never reach this conversation's transcript - a
 * delegate's are inside its `task` call, a voice task runs on an instance of
 * its own - so the harness's task activity is the only witness, read on the
 * same cadence the call stage reads it. Chat Stop uses this to cancel the
 * owning voice workers; desktop presence itself follows the live lease.
 */
export function useDelegatedComputerUse(conversationId: string): readonly DelegatedComputerUse[] {
  const [driving, setDriving] = useState<readonly DelegatedComputerUse[]>([])
  useEffect(() => {
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const address = await resolveHarnessAddress()
        if (closed || address === null) return
        const result = await createRequester(address).json('GET', `/api/tasks/activity?parentConversationId=${encodeURIComponent(conversationId)}`, undefined, parseDelegatedComputerUse)
        if (closed) return
        const next = result.ok ? result.value : []
        // Same answer, same array: the indicator's effect keys on it.
        setDriving((previous) => previous.length === next.length && previous.every((task, index) => task.id === next[index]?.id) ? previous : next)
      } catch { if (!closed) setDriving((previous) => previous.length === 0 ? previous : []) }
      finally { if (!closed) timer = setTimeout(() => { void poll() }, 1500) }
    }
    void poll()
    return () => { closed = true; clearTimeout(timer); setDriving([]) }
  }, [conversationId])
  return driving
}
