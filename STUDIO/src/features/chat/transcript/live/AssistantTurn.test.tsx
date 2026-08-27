/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MessageEnd, TranscriptItem } from '@/features/chat/transcript/projection'

import { AssistantTurn } from './AssistantTurn'

/**
 * The ending line, and the one window in which it must say nothing.
 *
 * The projection opens every assistant message `stopped` and that default is
 * correct — how a message ended comes from the log, never from silence. What
 * was wrong was rendering the conclusion before the message had an ending:
 * from `message-started` until `message-completed`, every live reply carried
 * a stop icon and "Stopped before finishing" under the text it was still
 * writing.
 */

function assistant(end: MessageEnd): Extract<TranscriptItem, { kind: 'assistant' }> {
  return {
    kind: 'assistant',
    id: 'msg_1',
    submissionId: 'sub_1',
    model: null,
    segments: [{ kind: 'text', id: 'run_1', text: 'half a sentence so far' }],
    end,
    usage: null,
  }
}

// jsdom has no `matchMedia`; the smooth reveal asks it about reduced motion.
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

afterEach(() => {
  cleanup()
})

describe('what a message being written says about how it ended', () => {
  it('says nothing at all while it is the one being written', () => {
    const { container } = render(<AssistantTurn item={assistant({ state: 'stopped' })} live />)
    expect(screen.queryByText('Stopped before finishing')).toBeNull()
    // The caret is what stands there instead: this message is being written,
    // which is the whole claim the ending line was contradicting.
    expect(container.querySelector('span.animate-pulse')).not.toBeNull()
  })

  it('still reads as stopped the moment no turn is running', () => {
    // The whole reason EndLine exists (Task 26): a message left unfinished by
    // a crash, a harness stop or an abort must say so immediately, with no
    // turn running and nothing else on screen to explain it.
    render(<AssistantTurn item={assistant({ state: 'stopped' })} live={false} />)
    expect(screen.getByText('Stopped before finishing')).toBeTruthy()
  })

  it('never swallows a failure or an abort, whatever the turn is doing', () => {
    // `live` suppresses exactly one state. Failed and aborted are facts the
    // settlement carried; a wider guard here would hide them for as long as
    // the phase said a turn was running.
    render(
      <AssistantTurn item={assistant({ state: 'failed', reason: 'the provider gave up' })} live />,
    )
    expect(screen.getByText('This turn failed')).toBeTruthy()
    expect(screen.getByText('the provider gave up')).toBeTruthy()

    cleanup()
    render(<AssistantTurn item={assistant({ state: 'aborted', reason: null })} live />)
    expect(screen.getByText('Aborted')).toBeTruthy()
  })
})
