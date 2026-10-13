import type { PendingSubmission } from '@/features/chat/transcript/projection'

const cache = new Map<string, readonly PendingSubmission[]>()
const key = (id: string) => `studio.queued.${id}`

export function queuedMessages(id: string): readonly PendingSubmission[] {
  const existing = cache.get(id)
  if (existing !== undefined) return existing
  const messages: PendingSubmission[] = []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(id)) ?? '[]')
    if (Array.isArray(value)) {
      for (const item of value) {
        const entry: unknown = item
        if (typeof entry !== 'object' || entry === null) continue
        if ('submissionId' in entry && 'text' in entry &&
          typeof entry.submissionId === 'string' && typeof entry.text === 'string') {
          messages.push({ submissionId: entry.submissionId, text: entry.text })
        }
      }
    }
  } catch { /* An unreadable display cache cannot trigger execution. */ }
  cache.set(id, messages)
  return messages
}

function save(id: string, messages: readonly PendingSubmission[]): void {
  cache.set(id, messages)
  // This is a display cache of receipts. Flue owns execution and durability;
  // restoring this list must never send a message again.
  try {
    if (messages.length === 0) localStorage.removeItem(key(id))
    else localStorage.setItem(key(id), JSON.stringify(messages))
  } catch { /* Receipts remain visible for this session when storage is unavailable. */ }
}

export function rememberQueued(id: string, message: PendingSubmission): void {
  save(id, [...queuedMessages(id), message])
}

export function forgetQueued(id: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return
  const current = queuedMessages(id)
  const remaining = current.filter((item) => !ids.has(item.submissionId))
  if (remaining.length !== current.length) save(id, remaining)
}
