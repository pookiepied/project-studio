import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Store } from '../src/store.mjs'

export function fixture(t, limits) {
  const root = mkdtempSync(join(tmpdir(), 'studio-inspector-'))
  const path = join(root, 'store.sqlite')
  const store = new Store(path, { writable: true, limits })
  const cleanup = []
  t.after(async () => {
    for (const close of cleanup.reverse()) await close()
    store.close()
    if (!resolve(root).startsWith(resolve(tmpdir()) + '\\studio-inspector-') && !resolve(root).startsWith(resolve(tmpdir()) + '/studio-inspector-')) throw new Error('Unsafe fixture cleanup')
    rmSync(root, { recursive: true, force: true })
  })
  return { root, path, store, cleanup }
}

export function event(sequence, extra = {}) {
  return { v: 1, eventId: `event-${sequence}`, bootId: 'source-boot', sequence,
    timestamp: '2026-10-17T00:00:00.000Z', monotonicMs: sequence,
    name: 'tools.execute', phase: 'end', outcome: 'completed',
    identity: { conversationId: 'conversation', operationId: `operation-${sequence}`, attemptId: `attempt-${sequence}` },
    attributes: {}, contentState: 'captured', content: { answer: `result-${sequence}` }, ...extra }
}
export function batch(events, extra = {}) { return { namespace: 'harness', bootId: 'source-boot', captureId: 'capture', events, health: {}, gap: false, ...extra } }
export function feed(events, extra = {}) {
  return { format: 'project-studio.inspector-feed', version: 1, status: 'ready', feedId: 'feed',
    health: { bootId: 'source-boot', captureId: 'capture', policy: { enabled: true, captureContent: true, conversations: ['conversation'] } },
    gap: false, events, ...extra }
}
