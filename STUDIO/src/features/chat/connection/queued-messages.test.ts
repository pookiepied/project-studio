/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

it('restores accepted queue receipts in order and removes only consumed messages', async () => {
  const queue = await import('./queued-messages')
  queue.rememberQueued('conversation', { submissionId: 'one', text: 'First task' })
  queue.rememberQueued('conversation', { submissionId: 'two', text: 'Next task' })
  vi.resetModules()
  const restored = await import('./queued-messages')
  expect(restored.queuedMessages('conversation')).toEqual([
    { submissionId: 'one', text: 'First task' },
    { submissionId: 'two', text: 'Next task' },
  ])
  restored.forgetQueued('conversation', new Set(['one']))
  expect(restored.queuedMessages('conversation')).toEqual([{ submissionId: 'two', text: 'Next task' }])
  restored.forgetQueued('conversation', new Set(['two']))
  expect(localStorage.getItem('studio.queued.conversation')).toBeNull()
})

it('rejects malformed cached receipts without creating work', async () => {
  localStorage.setItem('studio.queued.conversation', JSON.stringify([null, { submissionId: 7, text: 'bad' }]))
  const queue = await import('./queued-messages')
  expect(queue.queuedMessages('conversation')).toEqual([])
})
