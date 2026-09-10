/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePendingQuestions } from './usePendingQuestions'
import type { HarnessResult, PendingQuestionRecord } from '@/platform/harness'

/**
 * The ask-a-question channel's hook, at the point ADR 0050 §3.3 touches it.
 *
 * The broker settles a question once - whoever answers first wins, and every
 * other answer is refused with 404. What this window does with the refusal is
 * the whole subject here: the row leaves the screen at once and the harness's
 * own sentence stands where the card was, instead of a question vanishing one
 * poll later for no reason anyone was shown.
 *
 * The rest of the hook's behaviour (the poll cadence, the filter, the stop)
 * is the approvals hook's shape in a different coat, and the broker-side
 * settle-once is pinned in the harness's own suite. This file tests only what
 * this channel does with the race.
 */

const listPending = vi.fn<() => Promise<{ ok: true; value: readonly PendingQuestionRecord[] }>>()
// The result is the full union, not just the success half, because the race
// tests below answer with the harness's 404.
const answerQuestion = vi.fn(
  async (_id: string, _answer: unknown): Promise<HarnessResult<void>> => ({
    ok: true,
    value: undefined,
  }),
)
const stopQuestions = vi.fn(async (_conversationId: string) => ({
  ok: true as const,
  value: { stopped: 0 },
}))
const cancelQuestion = vi.fn(async (_id: string) => ({ ok: true as const, value: undefined }))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    questions: {
      list: () => listPending(),
      answer: (id: string, answer: unknown) => answerQuestion(id, answer),
      stop: (conversationId: string) => stopQuestions(conversationId),
      cancel: (id: string) => cancelQuestion(id),
    },
  }),
}))

/** Shaped like a row the harness sends, options as the ask tool declared them. */
function record(conversationId: string, id = 'q_1'): PendingQuestionRecord {
  return {
    id,
    conversationId,
    createdAt: 1_000,
    expiresAt: null,
    payload: {
      question: 'Which database should this use?',
      header: 'Storage',
      options: [
        {
          id: 'sqlite',
          label: 'SQLite (Recommended)',
          description: 'One file, no setup, the default for this workspace.',
        },
        {
          id: 'postgres',
          label: 'Postgres',
          description: 'A server to run and configure, for concurrent writes.',
        },
      ],
      multiSelect: false,
      recommendedOptionId: null,
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('answered elsewhere (ADR 0050 §3.3)', () => {
  it('removes a question the harness says is already answered, and says so', async () => {
    vi.useFakeTimers()
    listPending.mockResolvedValue({ ok: true, value: [record('cnv_x')] })

    const { result } = renderHook(() => usePendingQuestions('cnv_x'))
    await act(async () => {})
    expect(result.current.rows).toHaveLength(1)

    // The other window got there first; the reconciled queue no longer
    // returns the row on a read.
    answerQuestion.mockResolvedValueOnce({
      ok: false as const,
      error: {
        kind: 'harness-error' as const,
        status: 404,
        message: 'That question is no longer pending.',
      },
    })
    listPending.mockResolvedValue({ ok: true, value: [] })

    await act(async () => {
      await result.current.answer('q_1', { optionIds: ['sqlite'], deferred: false })
    })

    expect(result.current.rows).toHaveLength(0)
    expect(result.current.answeringId).toBeNull()
    expect(result.current.answeredElsewhere).toBe('That question is no longer pending.')
  })

  it('clears the sentence a few seconds later, when the moment has passed', async () => {
    vi.useFakeTimers()
    listPending.mockResolvedValue({ ok: true, value: [record('cnv_x')] })

    const { result } = renderHook(() => usePendingQuestions('cnv_x'))
    await act(async () => {})

    answerQuestion.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'harness-error' as const, status: 404, message: 'Gone.' },
    })
    listPending.mockResolvedValue({ ok: true, value: [] })
    await act(async () => {
      await result.current.answer('q_1', { deferred: true })
    })
    expect(result.current.answeredElsewhere).toBe('Gone.')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(result.current.answeredElsewhere).toBeNull()
    expect(result.current.rows).toHaveLength(0)
  })

  it('keeps a real refusal for the next poll, and says nothing about elsewhere', async () => {
    vi.useFakeTimers()
    listPending.mockResolvedValue({ ok: true, value: [record('cnv_x')] })

    const { result } = renderHook(() => usePendingQuestions('cnv_x'))
    await act(async () => {})

    // The harness refusing the reply itself - an option the question never
    // offered, say - is a failure, not a race.
    answerQuestion.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'harness-error' as const, status: 400, message: 'Bad answer.' },
    })
    await act(async () => {
      await result.current.answer('q_1', { optionIds: ['mongodb'], deferred: false })
    })

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.answeredElsewhere).toBeNull()
  })
})
