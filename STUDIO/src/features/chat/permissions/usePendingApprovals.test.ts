/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePendingApprovals } from './usePendingApprovals'
import type { PendingApprovalRecord } from '@/platform/harness'

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
const answerApproval = vi.fn(async (_id: string, _answer: unknown) => ({
  ok: true as const,
  value: undefined,
}))
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
