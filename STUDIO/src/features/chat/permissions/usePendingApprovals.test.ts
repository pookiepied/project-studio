/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePendingApprovals } from './usePendingApprovals'
import type { HarnessResult, PendingApprovalRecord } from '@/platform/harness'

/**
 * Which questions belong to this conversation.
 *
 * The store answers for every conversation at once, so this hook's whole job
 * on the way in is to keep the ones the conversation on screen raised. Get
 * that filter wrong in the direction of "matches nothing" and there is no
 * error anywhere: the poll succeeds, the list is empty, the prompt does not
 * render, and the run stays parked on an approval nobody is ever shown. The
 * model looks like it hung.
 *
 * That is what happened. The scope's conversation id used to be
 * `conversation:<id>` and this filter was written against it; the Flue 2.0
 * migration made the agent instance id the conversation id and dropped the
 * prefix - `studio-runtime.ts` says so in as many words - and nothing here was
 * tested, so the comparison went on being false forever.
 *
 * These tests are written against the id the harness actually sends today.
 */

const listPending = vi.fn<() => Promise<{ ok: true; value: readonly PendingApprovalRecord[] }>>()
// Typed with the arguments they actually receive: declared bare, the call
// tuple is empty and `toHaveBeenCalledWith` cannot be typed against them.
// The result is the full union, not just the success half, because the race
// tests below answer with the harness's 404.
const answerApproval = vi.fn(
  async (_id: string, _answer: unknown): Promise<HarnessResult<void>> => ({
    ok: true,
    value: undefined,
  }),
)
const cancelApproval = vi.fn(async (_id: string) => ({ ok: true as const, value: undefined }))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    approvals: {
      list: () => listPending(),
      answer: (id: string, answer: unknown) => answerApproval(id, answer),
      cancel: (id: string) => cancelApproval(id),
    },
  }),
}))

/** Shaped like a row the harness sends: the id is bare, with no prefix. */
function record(conversationId: string, id = 'ask_1'): PendingApprovalRecord {
  return {
    id,
    createdAt: 1_000,
    capabilityNamespace: 'native',
    capabilityName: 'write',
    capabilityTitle: 'Write file',
    resource: 'src/app.ts',
    conversationId,
    scopes: [{ id: 'once', label: 'Just once', detail: 'This call only', pattern: null }],
    source: 'policy',
    reason: 'Writing asks first.',
  }
}

const answered = (records: readonly PendingApprovalRecord[]) =>
  listPending.mockResolvedValue({ ok: true, value: records })

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('the questions one conversation owns', () => {
  it('shows a question whose scope carries the bare conversation id', async () => {
    // What the harness sends now. Under Flue 2.0 the agent instance id IS the
    // conversation id, so the scope carries `cnv_x`, not `conversation:cnv_x`.
    answered([record('cnv_x')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))

    await waitFor(() => expect(result.current.questions).toHaveLength(1))
  })

  it('leaves a question raised by another conversation alone', async () => {
    answered([record('cnv_other')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))

    await waitFor(() => expect(listPending).toHaveBeenCalled())
    // The store answers for every conversation; a question raised in one must
    // never appear over another one's composer.
    expect(result.current.questions).toHaveLength(0)
  })

  it('withdraws only the questions it owns', async () => {
    answered([record('cnv_x', 'mine'), record('cnv_other', 'theirs')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))
    await waitFor(() => expect(result.current.questions).toHaveLength(1))

    act(() => {
      result.current.cancelAll()
    })

    expect(cancelApproval).toHaveBeenCalledWith('mine')
    expect(cancelApproval).not.toHaveBeenCalledWith('theirs')
  })

  it('asks for nothing on a surface with no conversation behind it', async () => {
    answered([record('cnv_x')])

    renderHook(() => usePendingApprovals('cnv_x', { enabled: false }))

    // The gallery has no harness conversation behind it, so polling there
    // would be a request every ten seconds answering nobody's question.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(listPending).not.toHaveBeenCalled()
  })
})

describe('answered elsewhere (ADR 0050 §3.3)', () => {
  it('removes a prompt the harness says is already answered, and says so', async () => {
    vi.useFakeTimers()
    answered([record('cnv_x')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))
    await act(async () => {})
    expect(result.current.questions).toHaveLength(1)

    // Losing the race: this window's POST finds the row already answered.
    // The queue the mock serves after this moment is the reconciled one -
    // the row the other window settled no longer comes back on a read.
    answerApproval.mockResolvedValueOnce({
      ok: false as const,
      error: {
        kind: 'harness-error' as const,
        status: 404,
        message: 'That approval is no longer pending.',
      },
    })
    listPending.mockResolvedValue({ ok: true, value: [] })

    await act(async () => {
      await result.current.answer('ask_1', { verdict: 'allow', duration: 'once' })
    })

    // Gone now, not one poll from now - and the harness's own sentence,
    // verbatim, stands where the card was.
    expect(result.current.questions).toHaveLength(0)
    expect(result.current.answeringId).toBeNull()
    expect(result.current.answeredElsewhere).toBe('That approval is no longer pending.')
  })

  it('clears the sentence a few seconds later, when the moment has passed', async () => {
    vi.useFakeTimers()
    answered([record('cnv_x')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))
    await act(async () => {})

    answerApproval.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'harness-error' as const, status: 404, message: 'Gone.' },
    })
    listPending.mockResolvedValue({ ok: true, value: [] })
    await act(async () => {
      await result.current.answer('ask_1', { verdict: 'deny', duration: 'once' })
    })
    expect(result.current.answeredElsewhere).toBe('Gone.')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(result.current.answeredElsewhere).toBeNull()
    // The reconciled queue stays reconciled: no read brought the row back.
    expect(result.current.questions).toHaveLength(0)
  })

  it('keeps a real refusal for the next poll, and says nothing about elsewhere', async () => {
    vi.useFakeTimers()
    answered([record('cnv_x')])

    const { result } = renderHook(() => usePendingApprovals('cnv_x'))
    await act(async () => {})

    // Any refusal that is not the 404 is a failure, not a race - the row
    // stays on screen for the next poll to reconcile, exactly as before.
    answerApproval.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'harness-error' as const, status: 400, message: 'Bad answer.' },
    })
    await act(async () => {
      await result.current.answer('ask_1', { verdict: 'allow', duration: 'once' })
    })

    expect(result.current.questions).toHaveLength(1)
    expect(result.current.answeredElsewhere).toBeNull()
  })
})
