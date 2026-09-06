/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TurnStatus, hasVisibleReply } from './TurnStatus'
import type { ConversationPhase } from '@/features/chat/useConversation'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * The turn's status capsule, through its whole life.
 *
 * The states are the contract: sent-and-unanswered while the reply has put
 * nothing on screen, working once it has, a done beat when a run the pill
 * itself watched settles complete, and a quiet stand-down when the run ends
 * any other way. The witness rule matters as much as the states -- a pill
 * that mounts on a conversation whose run already finished confirms nothing,
 * because an ending nobody here waited through is not an event it saw.
 */

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
  vi.useRealTimers()
})

const SUBMITTED: ConversationPhase = { status: 'submitted', submissionId: 'sub_1' }
const STREAMING: ConversationPhase = {
  status: 'streaming',
  submissionId: 'sub_1',
  retrying: null,
}
const IDLE: ConversationPhase = { status: 'idle' }
const FAILED: ConversationPhase = {
  status: 'run-failed',
  outcome: 'failed',
  message: 'This turn failed',
  detail: null,
}

function user(text: string): TranscriptItem {
  return { kind: 'user', id: `u_${text}`, submissionId: null, text, attachments: [], timestamp: null }
}

function assistant(segments: readonly unknown[]): TranscriptItem {
  return {
    kind: 'assistant',
    id: 'a_1',
    submissionId: null,
    model: null,
    segments: segments.map((_, index) => ({
      kind: 'text' as const,
      id: `s_${index}`,
      text: 'a line of the reply',
    })),
    end: { state: 'stopped' },
    usage: null,
  }
}

describe('hasVisibleReply', () => {
  it('is false with nothing in the list at all', () => {
    expect(hasVisibleReply([])).toBe(false)
  })

  it('is false when the newest item is the words that were sent', () => {
    // The echo lands before the reply opens; until something of the answer
    // exists, the person is looking at their own message and silence.
    expect(hasVisibleReply([assistant(['one']), user('hello')])).toBe(false)
  })

  it('is false when the log opened the reply but no delta has landed', () => {
    expect(hasVisibleReply([user('hello'), assistant([])])).toBe(false)
  })

  it('is false when the newest assistant item is empty, even with answers above', () => {
    // An earlier turn's answer further up the list is not this turn's reply.
    expect(hasVisibleReply([assistant(['earlier']), user('again'), assistant([])])).toBe(false)
  })

  it('is true once the reply has any segment on screen', () => {
    expect(hasVisibleReply([user('hello'), assistant(['first lines'])])).toBe(true)
  })
})

describe('the working states', () => {
  it('names the silence while the reply has shown nothing', () => {
    render(<TurnStatus phase={SUBMITTED} items={[user('hello')]} />)
    expect(screen.getByText('Sent — waiting for the model to reply')).toBeTruthy()
  })

  it('keeps the waiting wording through a message with no deltas yet', () => {
    const view = render(<TurnStatus phase={SUBMITTED} items={[user('hello')]} />)
    view.rerender(
      <TurnStatus phase={STREAMING} items={[user('hello'), assistant([])]} />,
    )
    expect(screen.getByText('Sent — waiting for the model to reply')).toBeTruthy()
  })

  it('names the work once the reply is on screen', () => {
    render(<TurnStatus phase={STREAMING} items={[user('hello'), assistant(['lines'])]} />)
    expect(screen.getByText('Working on your reply')).toBeTruthy()
  })
})

describe('the done beat', () => {
  it('confirms a completion it watched, then leaves', async () => {
    vi.useFakeTimers()
    const view = render(<TurnStatus phase={STREAMING} items={[user('hello'), assistant(['lines'])]} />)

    view.rerender(<TurnStatus phase={IDLE} items={[user('hello'), assistant(['lines'])]} />)
    expect(screen.getByText('Done')).toBeTruthy()

    // The beat holds about three seconds, and then the pill lets itself go.
    vi.advanceTimersByTime(3000)
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByText('Done')).toBeNull())
  })

  it('confirms nothing for a run it did not watch', () => {
    // A conversation opened after the fact mounts on a settled phase; there
    // was no wait here and no ending to report.
    render(<TurnStatus phase={IDLE} items={[user('hello'), assistant(['lines'])]} />)
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByText(/Sent —/)).toBeNull()
  })

  it('stands down without a beat when the run ends any other way', async () => {
    vi.useFakeTimers()
    const view = render(<TurnStatus phase={STREAMING} items={[user('hello'), assistant(['lines'])]} />)

    view.rerender(<TurnStatus phase={FAILED} items={[user('hello'), assistant(['lines'])]} />)
    vi.useRealTimers()
    // The failure surfaces speak instead; the pill only leaves.
    await waitFor(() => expect(screen.queryByText('Working on your reply')).toBeNull())
    expect(screen.queryByText('Done')).toBeNull()
  })

  it('cuts the beat short when a new run starts under it', () => {
    vi.useFakeTimers()
    const view = render(<TurnStatus phase={IDLE} items={[user('hello'), assistant(['lines'])]} />)

    // Settle a watched run into its beat, then send again before it ends.
    view.rerender(<TurnStatus phase={STREAMING} items={[user('hello'), assistant(['lines'])]} />)
    view.rerender(<TurnStatus phase={IDLE} items={[user('hello'), assistant(['lines'])]} />)
    expect(screen.getByText('Done')).toBeTruthy()

    // The new turn's own echo lands under the pill, which retakes it in the
    // same render the run arrives -- the beat never paints past its run.
    view.rerender(
      <TurnStatus phase={SUBMITTED} items={[user('hello'), assistant(['lines']), user('again')]} />,
    )
    expect(screen.getByText('Sent — waiting for the model to reply')).toBeTruthy()
    expect(screen.queryByText('Done')).toBeNull()

    // The old beat's timer must not pull the pill out from under the new run.
    vi.advanceTimersByTime(5000)
    expect(screen.getByText('Sent — waiting for the model to reply')).toBeTruthy()
  })
})
