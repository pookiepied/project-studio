import { useMemo, useRef } from 'react'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { callsIn } from '@/features/chat/transcript/live/taskEvidence'
import { recordedChanges } from '@/features/changes/recordedChanges'
import type { TurnChanges } from '@/stores/rail'

/**
 * Every turn that changed files, oldest first, and the one answering the
 * person's latest message.
 *
 * Read from the file tools' receipts, the same records a reply's "Changed
 * files" reads, never from the disk. A turn is its submission; its time is
 * the person's message it answered.
 *
 * The list keeps its identity while nothing in it changed, so a chunk of
 * words streaming into a reply does not publish a "new" history to the
 * workspace on every token.
 */
export function useTurnChanges(items: readonly TranscriptItem[]): { turns: readonly TurnChanges[]; current: TurnChanges | null } {
  const previous = useRef<{ signature: string; turns: readonly TurnChanges[] }>({ signature: '', turns: [] })
  return useMemo(() => {
    const order: string[] = []
    const calls = new Map<string, ReturnType<typeof callsIn>>()
    const times = new Map<string, string | null>()
    let at: string | null = null
    let currentId: string | null = null
    for (const item of items) {
      if (item.kind === 'user') { at = item.timestamp; currentId = null; continue }
      if (item.kind !== 'assistant') continue
      const id = item.submissionId ?? item.id
      if (!calls.has(id)) { order.push(id); calls.set(id, []); times.set(id, at) }
      calls.get(id)?.push(...callsIn(item.segments))
      currentId = id
    }
    const built: TurnChanges[] = []
    for (const id of order) {
      const changes = recordedChanges(calls.get(id) ?? [])
      if (changes.length > 0) built.push({ id, at: times.get(id) ?? null, changes })
    }
    const signature = built.map((turn) => `${turn.id}:${turn.changes.map((change) => `${change.path}|${String(change.calls.length)}|${String(change.diff?.added ?? '')}|${String(change.diff?.removed ?? '')}`).join(',')}`).join(';')
    const turns = signature === previous.current.signature ? previous.current.turns : built
    previous.current = { signature, turns }
    return { turns, current: turns.find((turn) => turn.id === currentId) ?? null }
  }, [items])
}
