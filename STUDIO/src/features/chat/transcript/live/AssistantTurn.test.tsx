/**
 * @vitest-environment jsdom
 */
import { memo, useEffect, useCallback } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    const { container } = render(<AssistantTurn conversationId="conv" item={assistant({ state: 'stopped' })} live />)
    expect(screen.queryByText('Stopped before finishing')).toBeNull()
    // The caret is what stands there instead: this message is being written,
    // which is the whole claim the ending line was contradicting.
    expect(container.querySelector('span.animate-pulse')).not.toBeNull()
  })

  it('still reads as stopped the moment no turn is running', () => {
    // The whole reason EndLine exists (Task 26): a message left unfinished by
    // a crash, a harness stop or an abort must say so immediately, with no
    // turn running and nothing else on screen to explain it.
    render(<AssistantTurn conversationId="conv" item={assistant({ state: 'stopped' })} live={false} />)
    expect(screen.getByText('Stopped before finishing')).toBeTruthy()
  })

  it('never swallows a failure or an abort, whatever the turn is doing', () => {
    // `live` suppresses exactly one state. Failed and aborted are facts the
    // settlement carried; a wider guard here would hide them for as long as
    // the phase said a turn was running.
    render(
      <AssistantTurn conversationId="conv" item={assistant({ state: 'failed', reason: 'the provider gave up' })} live />,
    )
    expect(screen.getByText('This turn failed')).toBeTruthy()
    expect(screen.getByText('the provider gave up')).toBeTruthy()

    cleanup()
    render(<AssistantTurn conversationId="conv" item={assistant({ state: 'aborted', reason: null })} live />)
    expect(screen.getByText('Aborted')).toBeTruthy()
  })
})

describe('the action row under a finished answer', () => {
  const finished = (): Extract<TranscriptItem, { kind: 'assistant' }> => ({
    kind: 'assistant',
    id: 'msg_2',
    submissionId: 'sub_2',
    model: null,
    segments: [
      { kind: 'text', id: 'run_1', text: 'first paragraph' },
      { kind: 'tools', id: 'tools_1', groups: [] },
      { kind: 'text', id: 'run_2', text: 'second paragraph' },
    ],
    end: { state: 'complete' },
    usage: null,
  })

  it('copies the written runs in order, skipping everything between them', async () => {
    const writes: string[] = []
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    })
    render(<AssistantTurn conversationId="conv" item={finished()} live={false} onBranch={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writes).toEqual(['first paragraph\n\nsecond paragraph']))
  })

  it('carries the three verbs: copy, branch from here, read aloud', () => {
    // The same row the gallery's replies carry. Retry is deliberately absent
    // on both — redoing a turn that touched a workspace is the person's call
    // through their own tooling, not a button.
    const branch = vi.fn()
    render(<AssistantTurn conversationId="conv" item={finished()} live={false} onBranch={branch} />)
    expect(screen.getByRole('button', { name: 'Branch from here' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Branch from here' }))
    expect(branch).toHaveBeenCalledTimes(1)
  })

  it('withholds branch when no fork path was given, but copy stays', () => {
    render(<AssistantTurn conversationId="conv" item={finished()} live={false} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Branch from here' })).toBeNull()
  })

  it('stays down while the submission it belongs to is still in flight', () => {
    // A message can be complete while its run is not -- parked on a question
    // or a permission -- and a copy row under a run still owing its next
    // word is stray furniture, not an offer. Hovered or not.
    const { container } = render(<AssistantTurn conversationId="conv" item={finished()} live={false} turnInFlight />)
    fireEvent.pointerEnter(container.firstElementChild ?? container)
    const row = screen.getByRole('button', { name: 'Copy' }).closest('[class*="mb-4"]')
    expect(row?.className).toContain('pointer-events-none')
  })

  it('answers to hover once the submission has settled', () => {
    const { container } = render(<AssistantTurn conversationId="conv" item={finished()} live={false} />)
    const row = screen.getByRole('button', { name: 'Copy' }).closest('[class*="mb-4"]')
    expect(row?.className).toContain('pointer-events-none')
    fireEvent.pointerEnter(container.firstElementChild ?? container)
    expect(row?.className).not.toContain('pointer-events-none')
  })
})

/** The renders each Profiler saw, in order. */
const renders: string[] = []

/**
 * The memo boundary, measured where it matters: one message changing must
 * not re-render its neighbours. Every streamed delta used to walk the whole
 * window, and the thinking clock -- a one-second tick that can only show a
 * new number on a paint -- starved among the renders it caused, counting
 * 1, 2, 3, 4 and then jumping to 7.
 */
describe('the memo boundary', () => {
  /**
   * Marks its message id after every COMMITTED render of the boundary chain.
   * The watcher is itself memoized with stable marks, so the only thing that
   * can move it is the thing under test moving: an unchanged neighbour
   * sitting still while a sibling's delta lands.
   */
  const Watched = memo(function Watched({
    item,
    mark,
  }: {
    item: Extract<TranscriptItem, { kind: 'assistant' }>
    mark: (id: string) => void
  }) {
    useEffect(() => {
      mark(item.id)
    })
    return <AssistantTurn conversationId="conv" item={item} live={false} />
  })

  function Pair({ a, b }: { a: Extract<TranscriptItem, { kind: 'assistant' }>; b: Extract<TranscriptItem, { kind: 'assistant' }> }) {
    const markA = useCallback(() => renders.push('msg_1'), [])
    const markB = useCallback(() => renders.push('msg_2'), [])
    return (
      <>
        <Watched item={a} mark={markA} />
        <Watched item={b} mark={markB} />
      </>
    )
  }

  it('renders a row only when its own item changes', () => {
    const first = assistant({ state: 'complete' })
    const second: Extract<TranscriptItem, { kind: 'assistant' }> = {
      ...assistant({ state: 'complete' }),
      id: 'msg_2',
    }
    const view = render(<Pair a={first} b={second} />)
    renders.length = 0

    // A delta lands on the SECOND message: a new item object for it, the
    // first message's object untouched. The neighbour must sit still; the
    // changed row commits (its smooth reveal may commit twice, which is the
    // reveal's own beat and not the memo's business).
    const grown: TranscriptItem = {
      ...second,
      segments: [
        { kind: 'text', id: 'run_1', text: 'half a sentence so far, and more' },
      ],
    }
    view.rerender(<Pair a={first} b={grown} />)

    expect(renders).not.toContain('msg_1')
    expect(renders.filter((id) => id === 'msg_2').length).toBeGreaterThan(0)
  })
})
