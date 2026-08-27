/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssistantSegment, TranscriptItem } from '@/features/chat/transcript/projection'

import { AssistantTurn } from './AssistantTurn'

/**
 * What a reasoning run is allowed to say about its own duration.
 *
 * The span is the REASONING's, first delta to last — not the wait in front of
 * it. That wait is the provider's latency: measured on the real provider the
 * request leaves ~300ms after send and nothing comes back for seconds, and
 * during all of it the model has not been shown to be doing anything. Charging
 * that silence to the model's thinking made the number mean nothing, and it
 * put the word "Thinking" over a model that turned out not to reason at all.
 * The row that owns the silence is the `working` one, which names it as a wait.
 */

const ARRIVED = 1_700_000_000_000

function turn(options: {
  startedAt: number | null
  updatedAt: number | null
}): Extract<TranscriptItem, { kind: 'assistant' }> {
  const thinking: AssistantSegment = {
    kind: 'thinking',
    id: 'msg_1#think-0',
    text: 'working it out',
    startedAt: options.startedAt,
    updatedAt: options.updatedAt,
  }
  return {
    kind: 'assistant',
    id: 'msg_1',
    submissionId: 'sub_1',
    model: null,
    segments: [thinking],
    end: { state: 'complete' },
    usage: null,
  }
}

vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(ARRIVED + 60_000)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the duration a reasoning run is allowed to claim', () => {
  it('measures the reasoning itself, ignoring the wait before it', () => {
    render(
      <AssistantTurn
        item={turn({ startedAt: ARRIVED, updatedAt: ARRIVED + 4_000 })}
        live={false}
      />,
    )
    expect(screen.getByText('Thought for 4s')).toBeTruthy()
  })

  it('claims nothing when the whole trace arrived in ONE batch', () => {
    // Two identical timestamps are one observation, not a span of zero. This
    // is the common case on a provider that emits its reasoning at the end,
    // and a fabricated "a moment" there reads as an answer.
    render(
      <AssistantTurn item={turn({ startedAt: ARRIVED, updatedAt: ARRIVED })} live={false} />,
    )
    expect(screen.getByText('Thought')).toBeTruthy()
    expect(screen.queryByText(/Thought for/)).toBeNull()
  })

  it('claims nothing for a run that was replayed rather than watched', () => {
    render(<AssistantTurn item={turn({ startedAt: null, updatedAt: null })} live={false} />)
    expect(screen.getByText('Thought')).toBeTruthy()
    expect(screen.queryByText(/Thought for/)).toBeNull()
  })
})
