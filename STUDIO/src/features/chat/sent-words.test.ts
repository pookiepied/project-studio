/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChunkFacts } from '@/platform/harness'
import { readChunkFacts } from '@/platform/harness'
import {
  forgetFirstAdmission,
  rememberFirstAdmission,
} from '@/features/chat/first-attach'
import type {
  ConversationContent,
  ConversationPhase,
  ConversationView,
} from '@/features/chat/useConversation'

/**
 * Where a sent message lives between leaving the composer and reaching the log.
 *
 * The harness records a user's own message and hands it back; until it does,
 * this window is the only place those words exist. They used to exist nowhere:
 * the composer cleared, the transcript stayed empty for the length of the
 * round trip, and the only thing on the page was a mark that then jumped when
 * the echo arrived above it.
 *
 * `useConversation` is the seam. It owns the connection and the receipt; this
 * hook owns what is on screen, which is the only thing under test here.
 */

type Submit = ConversationView['submit']

interface Connection {
  deliver: (content: ConversationContent) => void
  submit: ReturnType<typeof vi.fn<Submit>>
  phase: ConversationPhase
}

const connection: Connection = {
  deliver: () => {},
  submit: vi.fn<Submit>(),
  phase: { status: 'live' },
}

vi.mock('@/features/chat/useConversation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/useConversation')>()
  return {
    ...actual,
    useConversation: (
      _id: string,
      options: { onContent: (content: ConversationContent) => void },
    ): ConversationView => {
      connection.deliver = options.onContent
      return {
        phase: connection.phase,
        offset: null,
        resume: () => {},
        submit: connection.submit,
        abort: async () => ({ ok: true, value: true }),
        refused: null,
        dismissRefusal: () => {},
      }
    },
  }
})

const { useConversationTranscript } = await import('@/features/chat/useConversationTranscript')

const WORDS = 'what did you make of it?'

/** What every send here carries: the default-shaped settings. */
const SETTINGS = { modelId: null, reasoningLevel: 'default' } as const

function admits(submissionId: string) {
  return async () => ({ ok: true as const, value: { submissionId } })
}

function refuses() {
  return async () => ({
    ok: false as const,
    error: { kind: 'no-harness' as const, message: 'nothing to send this to' },
  })
}

function echo(submissionId: string, text: string): ChunkFacts[] {
  const chunk = readChunkFacts({
    type: 'message-appended',
    message: {
      id: 'u1',
      role: 'user',
      submissionId,
      metadata: { timestamp: '2026-08-26T00:00:00Z' },
      parts: [{ type: 'text', text, state: 'done' }],
    },
    position: { batch: 1, index: 0 },
  })
  if (chunk === null) throw new Error('test built an unparseable chunk')
  return [chunk]
}

afterEach(() => {
  forgetFirstAdmission('cnv_1')
  connection.submit.mockReset()
})

describe('a message between the composer and the log', () => {
  it('is on the page as soon as the harness says it has it', async () => {
    connection.submit.mockImplementation(admits('sub_1'))
    const view = renderHook(() => useConversationTranscript('cnv_1'))

    await act(async () => {
      await view.result.current.submit(WORDS, SETTINGS)
    })

    expect(view.result.current.pending).toEqual({
      submissionId: 'sub_1',
      text: WORDS,
      // Stamped where the receipt is read. Its exact value is the clock's;
      // that it exists is what every duration about this turn depends on.
      at: expect.any(Number),
    })
  })

  it('is not on the page when the harness refused to take it', async () => {
    // The words are still in the composer, which is where Task 32 put them.
    // Drawing them in the transcript as well would claim they were sent.
    connection.submit.mockImplementation(refuses())
    const view = renderHook(() => useConversationTranscript('cnv_1'))

    await act(async () => {
      await view.result.current.submit(WORDS, SETTINGS)
    })

    expect(view.result.current.pending).toBeNull()
  })

  it('hands over to the log, once, when the echo arrives', async () => {
    connection.submit.mockImplementation(admits('sub_1'))
    const view = renderHook(() => useConversationTranscript('cnv_1'))

    await act(async () => {
      await view.result.current.submit(WORDS, SETTINGS)
    })
    act(() => {
      connection.deliver({ kind: 'chunks', replaying: false, chunks: echo('sub_1', WORDS) })
    })

    await waitFor(() => expect(view.result.current.pending).toBeNull())
    expect(view.result.current.items).toHaveLength(1)
  })
})

describe('a conversation opened by its own first turn', () => {
  it('opens with the words that started it already on the page', () => {
    // They were typed on another page and admitted there. Asserted on the
    // FIRST render: waiting for the echo is exactly the empty column this
    // exists to remove, and an effect that ran a tick late would still show
    // one frame of it.
    rememberFirstAdmission('cnv_1', {
      offset: '9_4',
      submissionId: 'sub_first',
      text: 'the first thing anyone types',
      at: 1_700_000_000_000,
    })
    const view = renderHook(() => useConversationTranscript('cnv_1'))

    expect(view.result.current.pending).toEqual({
      submissionId: 'sub_first',
      text: 'the first thing anyone types',
      // The moment the receipt was answered, carried across the navigation.
      // Counting from the mount instead would charge the model for the
      // navigation and make every first turn look slower than it was.
      at: 1_700_000_000_000,
    })
    expect(view.result.current.items).toEqual([])
  })

  it('opens empty when there was no first turn to carry', () => {
    const view = renderHook(() => useConversationTranscript('cnv_1'))

    expect(view.result.current.pending).toBeNull()
  })

  it('starts over when the view is pointed at a different conversation', async () => {
    // The seeding above happens during render, so an effect guards against
    // repeating it on mount. That guard must not also swallow a real change of
    // id: the old transcript belongs to another conversation, and a delivery
    // for the new one landing on top of it would splice two together.
    connection.submit.mockImplementation(admits('sub_1'))
    const view = renderHook((id: string) => useConversationTranscript(id), {
      initialProps: 'cnv_1',
    })
    await act(async () => {
      await view.result.current.submit(WORDS, SETTINGS)
    })
    act(() => {
      connection.deliver({ kind: 'chunks', replaying: false, chunks: echo('sub_1', WORDS) })
    })
    await waitFor(() => expect(view.result.current.items).toHaveLength(1))

    view.rerender('cnv_2')

    expect(view.result.current.items).toEqual([])
    expect(view.result.current.pending).toBeNull()
  })
})
