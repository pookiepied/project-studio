/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useForkConversation } from './fork'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import type { Conversation } from '@/domain/conversation/types'

/**
 * A fork duplicates the conversation server-side and opens it - no turn is
 * admitted, no model is called. These pin that the duplication, the local
 * adoption and the navigation all address one minted id, and that a refusal
 * admits nothing anywhere.
 */

function user(id: string, submissionId: string | null): TranscriptItem {
  return {
    kind: 'user',
    id,
    submissionId,
    text: 'What eats reeds?',
    attachments: [],
    documents: [],
    timestamp: null,
  }
}

function assistant(id: string, submissionId: string | null): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId,
    model: null,
    segments: [{ kind: 'text', id: `run-${id}`, text: 'Many grazers do.' }],
    end: { state: 'complete' },
    usage: null,
  }
}

const conversation: readonly TranscriptItem[] = [
  user('u1', 'sub_1'),
  assistant('a1', 'sub_1'),
  user('u2', 'sub_2'),
  assistant('a2', 'sub_2'),
]

const { adoptConversation, openChat, forkConversation } = vi.hoisted(() => ({
  adoptConversation: vi.fn(),
  openChat: vi.fn(),
  forkConversation: vi.fn(),
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ adoptConversation }),
}))

vi.mock('@/stores/navigation', () => ({
  useNavigation: () => ({ openChat }),
}))

vi.mock('@/platform/harness', () => ({
  resolveHarnessAddress: () => Promise.resolve('http://127.0.0.1:9'),
  createHarnessClient: () => ({ forkConversation }),
}))

const SOURCE: Conversation = {
  id: 'cnv_source',
  title: 'Reeds',
  projectId: null,
  updatedAt: 1,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  permissionMode: 'ask',
}

describe('forking as one conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forks whole with a single id from duplication through navigation', async () => {
    forkConversation.mockResolvedValue({
      ok: true,
      value: { id: 'cnv_fork', title: 'Reeds (Fork)' },
    })

    const { result } = renderHook(() => useForkConversation())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.forkWhole(SOURCE)
    })

    expect(outcome).toEqual({ ok: true, conversationId: expect.any(String) })
    const target = (outcome as { conversationId: string }).conversationId
    expect(target).toMatch(/^cnv_/)
    expect(forkConversation).toHaveBeenCalledTimes(1)
    expect(forkConversation).toHaveBeenCalledWith('cnv_source', target, undefined)
    expect(adoptConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: target, title: 'Reeds (Fork)' }),
    )
    expect(openChat).toHaveBeenCalledWith(target)
  })

  it('branches at the submission behind the named answer', async () => {
    forkConversation.mockResolvedValue({
      ok: true,
      value: { id: 'cnv_fork', title: 'Reeds (Fork)' },
    })

    const { result } = renderHook(() => useForkConversation())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.branchFrom(SOURCE, conversation, 'a1')
    })

    expect(outcome).toEqual({ ok: true, conversationId: expect.any(String) })
    const target = (outcome as { conversationId: string }).conversationId
    expect(forkConversation).toHaveBeenCalledWith('cnv_source', target, 'sub_1')
    expect(adoptConversation).toHaveBeenCalledWith(expect.objectContaining({ id: target }))
    expect(openChat).toHaveBeenCalledWith(target)
  })

  it('branches whole when the named message carries no submission', async () => {
    forkConversation.mockResolvedValue({
      ok: true,
      value: { id: 'cnv_fork', title: 'Reeds (Fork)' },
    })

    const { result } = renderHook(() => useForkConversation())
    await act(async () => {
      await result.current.branchFrom(
        SOURCE,
        [{ kind: 'compaction', id: 'c1', summary: 'reeds', tokensBefore: 9, timestamp: null }],
        'c1',
      )
    })

    expect(forkConversation).toHaveBeenCalledWith(
      'cnv_source',
      expect.any(String),
      undefined,
    )
  })

  it('admits nothing when the harness refuses the duplication', async () => {
    forkConversation.mockResolvedValue({
      ok: false,
      error: { kind: 'harness-error', message: 'a turn is in flight', status: 409, timedOut: false },
    })

    const { result } = renderHook(() => useForkConversation())
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.forkWhole(SOURCE)
    })

    expect(outcome).toEqual({ ok: false, note: 'a turn is in flight' })
    expect(adoptConversation).not.toHaveBeenCalled()
    expect(openChat).not.toHaveBeenCalled()
  })
})
