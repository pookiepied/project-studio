import { useSyncExternalStore } from 'react'
import { isRecord } from '@/lib/guards'
import { resolveHarnessAddress } from '@/platform/harness'
import { createRequester } from '@/platform/harness/client/request'

export interface ComputerPresence {
  readonly conversationId: string | null
  readonly mode: 'active' | 'paused' | 'demonstrating' | 'stopping'
}

export function parseComputerPresence(value: unknown): ComputerPresence | null {
  if (!isRecord(value)) return null
  if (value.conversationId !== null && (typeof value.conversationId !== 'string' || value.conversationId.length === 0)) return null
  if (value.mode !== 'active' && value.mode !== 'paused' && value.mode !== 'demonstrating' && value.mode !== 'stopping') return null
  return { conversationId: value.conversationId, mode: value.mode }
}

let snapshot: ComputerPresence | null = null
const listeners = new Set<() => void>()
let epoch = 0
let timer: ReturnType<typeof setTimeout> | undefined

function publish(next: ComputerPresence | null) {
  if (snapshot === next || (snapshot !== null && next !== null && snapshot.conversationId === next.conversationId && snapshot.mode === next.mode)) return
  snapshot = next
  for (const listener of listeners) listener()
}

async function poll(started: number) {
  let next: ComputerPresence | null = null
  try {
    const address = await resolveHarnessAddress()
    if (started !== epoch) return
    if (address !== null) {
      const result = await createRequester(address).json('GET', '/api/computer/activity', undefined, parseComputerPresence, 2500)
      if (result.ok) next = result.value
    }
  } catch { /* Missing evidence remains unknown, never inferred from history. */ }
  if (started !== epoch) return
  publish(next)
  timer = setTimeout(() => { void poll(started) }, 500)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) { epoch += 1; void poll(epoch) }
  return () => {
    listeners.delete(listener)
    if (listeners.size !== 0) return
    epoch += 1
    clearTimeout(timer)
    snapshot = null
  }
}

/** One bounded poll shared by the desktop sign and rail, independent of chat replay. */
export function useComputerPresence(): ComputerPresence | null {
  return useSyncExternalStore(subscribe, () => snapshot)
}
