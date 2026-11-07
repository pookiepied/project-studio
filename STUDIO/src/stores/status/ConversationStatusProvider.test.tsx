/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationStatusProvider, useConversationStatuses } from './ConversationStatusProvider'

const ok = <T,>(value: T) => ({ ok: true as const, value })
const down = { ok: false as const, error: { kind: 'not-reachable' as const, message: 'down' } }

const harness = vi.hoisted(() => ({
  running: [] as string[],
  approvals: [] as { conversationId: string }[],
  questions: [] as { conversationId: string }[],
  reachable: true,
}))
const live = vi.hoisted(() => ({ witnessed: new Set<string>(), markRunning: vi.fn() }))
const page = vi.hoisted(() => ({ openId: null as string | null }))

const workspace = {
  runningConversations: async () => (harness.reachable ? ok(harness.running) : down),
  approvals: { list: async () => (harness.reachable ? ok(harness.approvals) : down) },
  questions: { list: async () => (harness.reachable ? ok(harness.questions) : down) },
}

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => workspace,
  useLiveWork: () => ({ running: live.witnessed, markRunning: live.markRunning }),
}))
vi.mock('@/stores/navigation', () => ({
  useNavigation: () => ({
    route: page.openId === null ? { kind: 'home' } : { kind: 'chat', conversationId: page.openId },
  }),
}))

function Probe() {
  const statuses = useConversationStatuses()
  return <p data-testid="statuses">{[...statuses].map(([id, status]) => `${id}:${status}`).sort().join(' ')}</p>
}

const tree = () => (
  <ConversationStatusProvider>
    <Probe />
  </ConversationStatusProvider>
)
const shown = () => screen.getByTestId('statuses').textContent
const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(6_000))

beforeEach(() => {
  vi.useFakeTimers()
  harness.running = []
  harness.approvals = []
  harness.questions = []
  harness.reachable = true
  live.witnessed = new Set()
  live.markRunning.mockClear()
  page.openId = null
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('conversation status', () => {
  it('reports a run the harness holds, open here or not', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()
    expect(shown()).toBe('a:running')
  })

  it('calls a run that ended elsewhere finished, and only that', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()

    harness.running = []
    await nextPoll()
    expect(shown()).toBe('a:done')
  })

  it('never calls a conversation that was idle all along finished', async () => {
    render(tree())
    await nextPoll()
    expect(shown()).toBe('')
  })

  it('does not call a run finished when it ended on screen', async () => {
    page.openId = 'a'
    harness.running = ['a']
    render(tree())
    await nextPoll()

    harness.running = []
    await nextPoll()
    expect(shown()).toBe('')
  })

  it('clears finished when the conversation is opened', async () => {
    harness.running = ['a']
    const { rerender } = render(tree())
    await nextPoll()
    harness.running = []
    await nextPoll()

    page.openId = 'a'
    rerender(tree())
    await nextPoll()
    expect(shown()).toBe('')
  })

  it('puts a question ahead of the run it parked', async () => {
    harness.running = ['a', 'b']
    harness.approvals = [{ conversationId: 'a' }]
    harness.questions = [{ conversationId: 'b' }]
    render(tree())
    await nextPoll()
    expect(shown()).toBe('a:input b:input')
  })

  it('shows a question that outlived its run', async () => {
    harness.questions = [{ conversationId: 'a' }]
    render(tree())
    await nextPoll()
    expect(shown()).toBe('a:input')
  })

  it('clears a mark a closed page left behind, but not the open page’s', async () => {
    live.witnessed = new Set(['closed', 'open'])
    page.openId = 'open'
    render(tree())
    await nextPoll()

    expect(live.markRunning).toHaveBeenCalledWith('closed', false)
    expect(live.markRunning).not.toHaveBeenCalledWith('open', false)
  })

  it('notices a run that ended while the window was gone', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()
    cleanup()

    harness.running = []
    render(tree())
    await nextPoll()
    expect(shown()).toBe('a:done')
  })

  it('keeps a finished mark across a reload until it is opened', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()
    harness.running = []
    await nextPoll()
    cleanup()

    render(tree())
    await nextPoll()
    expect(shown()).toBe('a:done')
  })

  it('calls nothing finished before the harness has answered', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()
    cleanup()

    harness.reachable = false
    render(tree())
    await nextPoll()
    expect(shown()).toBe('')
  })

  it('reads at once when the window comes back', async () => {
    render(tree())
    await nextPoll()

    harness.running = ['a']
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(shown()).toBe('a:running')
  })

  it('keeps what it knew when the harness cannot be read', async () => {
    harness.running = ['a']
    render(tree())
    await nextPoll()

    harness.reachable = false
    await nextPoll()
    expect(shown()).toBe('a:running')
  })
})
