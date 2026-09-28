/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConversationPhase } from '@/features/chat/connection/useConversation'
import type {
  PendingSubmission,
  TranscriptItem,
} from '@/features/chat/transcript/projection'

import { LiveTranscript } from './LiveTranscript'

/**
 * What the list says about a turn while the turn is happening.
 *
 * The rule it settled on: the list draws what the model has produced, and
 * nothing standing in for what it has not. Whether a turn exists is still a
 * question the list answers — a scheduled retry is named in words — but an
 * ordinary silence gets no row.
 *
 * Whether text is being produced is the separate question, and it decides the
 * caret and, with it, whether a message's ending may be spoken for yet.
 */

// jsdom has neither of these; a user bubble measures itself with one, and the
// smooth reveal asks the other about reduced motion.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

function user(id: string, text: string): TranscriptItem {
  return { kind: 'user', id, submissionId: 'sub_1', text, attachments: [], documents: [], timestamp: null }
}

function assistant(id: string, text: string): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId: 'sub_1',
    model: null,
    segments: [{ kind: 'text', id: `${id}_run`, text }],
    end: { state: 'stopped' },
    usage: null,
  }
}

/** When a reasoning run opened, in the tests that care. */
const THINKING_OPENED = 1_700_000_000_000

/** A reply whose only content so far is a reasoning run. */
function reasoning(
  id: string,
  text: string,
  startedAt: number | null,
  updatedAt: number | null,
): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId: 'sub_1',
    model: null,
    segments: [{ kind: 'thinking', id: `${id}_think`, text, startedAt, updatedAt }],
    end: { state: 'stopped' },
    usage: null,
  }
}

/**
 * A message that exists in the log and has nothing on the page: what
 * `message-started` produces, before its first delta arrives.
 */
function openedAssistant(id: string): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId: 'sub_1',
    model: null,
    segments: [],
    end: { state: 'stopped' },
    usage: null,
  }
}

const SUBMITTED: ConversationPhase = { status: 'submitted', submissionId: 'sub_1' }
const STREAMING: ConversationPhase = {
  status: 'streaming',
  submissionId: 'sub_1',
  retrying: null,
}

function show(
  items: readonly TranscriptItem[],
  phase: ConversationPhase,
  pending: PendingSubmission | null = null,
  compacting = false,
) {
  return render(
    <LiveTranscript
      items={items}
      pending={pending}
      phase={phase}
      viewport={createRef<HTMLElement>()}
      conversationId="conv"
      compacting={compacting}
    />,
  )
}

afterEach(() => {
  cleanup()
})

/**
 * The window between sending and the model producing anything.
 *
 * It used to carry a row that counted and called itself "Working". It carries
 * nothing now, and the reasoning is in `LiveTranscript`'s own docblock: a turn
 * being in flight is said by the ring on the send control, at the reader's
 * hand, from the instant they send. Saying it a second time in the transcript
 * put a claim where content goes.
 *
 * "Nothing" is about CLAIMS, not pixels: the words just sent stand there, with
 * their hover action row (invisible until hovered, and not a claim), and the
 * gap between them and the reply draws no caret, no working mark, and no word.
 * The assertions below therefore ask for the absence of the specific lies this
 * window once told rather than for an empty container.
 */
function silence(container: HTMLElement): void {
  expect(container.querySelector('span.animate-pulse')).toBeNull()
  expect(container.textContent).not.toContain('Working')
  expect(container.textContent).not.toContain('Thinking')
}

describe('the silence between sending and the first token', () => {
  it('draws nothing while the turn is only admitted', () => {
    // The measured gap on the real provider was six seconds of a
    // seven-second turn.
    const { container } = show([user('u1', 'please answer')], SUBMITTED)
    silence(container)
  })

  it('draws nothing when nothing has been submitted either', () => {
    const { container } = show([user('u1', 'please answer')], { status: 'live' })
    silence(container)
  })

  it('draws nothing while the reply exists in the log but not on the page', () => {
    // `message-started` creates an assistant message with no segments. It is
    // a fact about the log, not about the screen, and the screen says nothing
    // about it.
    const { container } = show([user('u1', 'please answer'), openedAssistant('a1')], STREAMING)
    silence(container)
  })

  it('never claims the model is thinking before a run exists', () => {
    // The claim the app could not support, and the one that survived two
    // rewrites: on four models across three providers, none of them produced
    // a reasoning trace, and the row said "Thinking" through every one.
    show([user('u1', 'please answer')], SUBMITTED)
    expect(screen.queryByText(/Thinking/)).toBeNull()
    expect(screen.queryByText(/Working/)).toBeNull()
  })
})

describe('the row that appears when reasoning does', () => {
  it('is drawn as soon as the run opens, before its first delta', () => {
    // `assistant_reasoning_started` is the wire saying a run exists. That is
    // the earliest moment anything here may say the model is thinking, and it
    // is also the moment it must.
    vi.useFakeTimers()
    vi.setSystemTime(THINKING_OPENED + 400)
    try {
      show([user('u1', 'please answer'), reasoning('a1', '', THINKING_OPENED, null)], STREAMING)
      expect(screen.getByText('Thinking')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the run, not the wait that preceded it', () => {
    // The receipt is far in the past; the run is 2s long. Anchoring to the
    // receipt is what made the number a measure of provider latency.
    show(
      [
        user('u1', 'please answer'),
        reasoning('a1', 'working it out', THINKING_OPENED, THINKING_OPENED + 2_000),
      ],
      { status: 'idle' },
    )
    expect(screen.getByText('Thought for 2s')).toBeTruthy()
  })
})

describe('what the newest message says about its ending', () => {
  it('says nothing while the turn is producing it', () => {
    show([user('u1', 'hello'), assistant('a1', 'writing this out')], STREAMING)
    expect(screen.queryByText('Stopped before finishing')).toBeNull()
  })

  it('says it once the turn is over', () => {
    show([user('u1', 'hello'), assistant('a1', 'cut off here')], { status: 'idle' })
    expect(screen.getByText('Stopped before finishing')).toBeTruthy()
  })

  it('keeps saying it about an older unfinished message while a NEW turn is admitted', () => {
    // The adversarial case for widening "a turn is running". The previous
    // turn died mid-sentence; the person sends again; for the second or so
    // before the new turn's own replay puts their words on the page, the
    // newest message on screen is still that dead one. An admitted turn is
    // not writing it, so its ending stands and nothing wears a caret.
    const { container } = show(
      [user('u1', 'hello'), assistant('a1', 'died mid sentence')],
      SUBMITTED,
    )
    expect(screen.getByText('Stopped before finishing')).toBeTruthy()
    expect(container.querySelector('span.animate-pulse')).toBeNull()
  })
})

describe('which reply counts as the one being written', () => {
  it('is the newest assistant message, even with a user message after it', () => {
    // The log can put a user message behind a reply that has already opened —
    // a second submission, or an echo landing after its own `message-started`.
    // Reading only the tail made the reply stop counting as newest at that
    // moment: its caret went out and "Stopped before finishing" appeared under
    // text that was still arriving.
    const { container } = show(
      [assistant('a1', 'still being written'), user('u2', 'and another thing')],
      STREAMING,
    )

    expect(screen.queryByText('Stopped before finishing')).toBeNull()
    expect(container.querySelector('span.animate-pulse')).not.toBeNull()
  })
})

describe('items that would draw nothing at all', () => {
  /** The list is a gap-6 column, so every direct child costs 24px of gap. */
  function slots(container: HTMLElement): number {
    const list = container.firstElementChild
    if (list === null) throw new Error('no list')
    return list.childElementCount
  }

  it('take no slot while the reply is open and still empty', () => {
    // Measured on a real turn: the reasoning row sat still for nine seconds,
    // dropped exactly 24px when `message-started` arrived, and came back when
    // the content did. The message drew nothing the whole time — the gap
    // around it was the entire visible event.
    const opened = show([user('u1', 'please answer'), openedAssistant('a1')], STREAMING)
    const openedSlots = slots(opened.container)
    cleanup()

    const bare = show([user('u1', 'please answer')], STREAMING)
    expect(openedSlots).toBe(slots(bare.container))
  })

  it('keep their slot when the message has an ending to report', () => {
    // A turn that died before producing anything: the "stopped" line under an
    // empty message is the only evidence on screen that it happened at all.
    const { container } = show([user('u1', 'please answer'), openedAssistant('a1')], {
      status: 'idle',
    })
    expect(screen.getByText('Stopped before finishing')).toBeTruthy()
    expect(slots(container)).toBe(2)
  })
})

describe('the tail of a turn that has just been sent', () => {
  const HELD: PendingSubmission = {
    submissionId: 'sub_1',
    text: 'what did you make of it?',
  }

  it('shows the words immediately, before the log has echoed them', () => {
    // The first thing the sender looks for is their own message. It used to
    // arrive on the harness's schedule, about a second later, and until then
    // the page was empty apart from a mark.
    show([], SUBMITTED, HELD)
    expect(screen.getByText('what did you make of it?')).toBeTruthy()
  })

  it('shows them exactly once at the seam where the echo lands', () => {
    // Both can be true for one render: the projection retires the held words
    // when the echo is applied, so the list already carries them. If the two
    // were ever drawn together the message would appear twice.
    show([user('u1', 'what did you make of it?')], SUBMITTED, null)
    expect(screen.getAllByText('what did you make of it?')).toHaveLength(1)
  })

  it('shows the words and nothing else, on a first turn or a later one', () => {
    // The sent message is the only thing this window knows to be true yet.
    // Every turn after the first is sent into a transcript whose last item is
    // a finished reply full of text, and neither case adds a row.
    const first = show([], SUBMITTED, HELD)
    silence(first.container)
    cleanup()

    // The older reply carries its own "stopped" line, mark and all, so this
    // one asks the narrower question: no row claiming anything about the new
    // turn.
    show([user('u1', 'earlier'), assistant('a1', 'an answer from before')], SUBMITTED, HELD)
    expect(screen.getByText('what did you make of it?')).toBeTruthy()
    expect(screen.queryByText(/Thinking|Thought|Working/)).toBeNull()
  })
})

/**
 * A compaction, from the ask to the record.
 *
 * The ask used to be silence: the field cleared, the request ran for
 * seconds, and the record only appeared when the conversation was reopened.
 * Now the ask says itself at the tail — the same line the record will speak
 * from — and the record is a statement, not a control.
 */
describe('a compaction of this conversation', () => {
  function compaction(id: string, tokensBefore: number): TranscriptItem {
    return {
      kind: 'compaction',
      id,
      summary: 'The model folded the earlier turns into a working summary.',
      tokensBefore,
      timestamp: null,
    }
  }

  it('says the compaction is running, at the tail, while the store marks it', () => {
    show([user('u1', 'earlier'), assistant('a1', 'an answer')], { status: 'idle' }, null, true)
    expect(screen.getByText('Compacting conversation')).toBeTruthy()
  })

  it('says nothing about a compaction no one asked for', () => {
    const { container } = show([user('u1', 'earlier')], { status: 'idle' })
    expect(screen.queryByText('Compacting conversation')).toBeNull()
    silence(container)
  })

  it('lands the record as one quiet line, with what the window held', () => {
    show([user('u1', 'earlier'), compaction('c1', 172_000)], { status: 'idle' })
    expect(screen.getByText(/Conversation compacted/)).toBeTruthy()
    expect(screen.getByText(/172k folded into a summary/)).toBeTruthy()
  })

  it('is a statement, not a control — and keeps the summary to the model', () => {
    // Alone on the page, so the only button a match could find would be the
    // row's own — which is the claim being refused.
    show([compaction('c1', 172_000)], { status: 'idle' })
    // Nothing on the row is a button: no disclosure to open, no chevron
    // promising a body. The summary rides in the item and must not be drawn.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/folded the earlier turns into a working summary/)).toBeNull()
  })

  it('says nothing about how much moved when nothing was measured', () => {
    show([compaction('c1', 0)], { status: 'idle' })
    expect(screen.getByText(/Conversation compacted/)).toBeTruthy()
    expect(screen.queryByText(/folded into a summary/)).toBeNull()
  })
})
