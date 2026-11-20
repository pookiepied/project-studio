/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readChunkFacts } from '@/platform/harness/contracts/chunks'
import type { ConversationContent } from './useConversation'
import { useConversationTranscript } from './useConversationTranscript'

let deliver: ((content: ConversationContent) => void) | undefined
let phase: { status: 'live' } | { status: 'streaming'; submissionId: string } = { status: 'live' }
vi.mock('./useConversation', () => ({
  useConversation: (_id: string, options: { onContent: typeof deliver }) => {
    deliver = options.onContent
    return { phase }
  },
}))

afterEach(() => { cleanup(); phase = { status: 'live' } })

it('reveals on live Studio Browser navigation and ignores replay and other tool activity', () => {
  const reveal = vi.fn()
  renderHook(() => useConversationTranscript('cnv_1', reveal))
  const emit = (toolName: string, replaying: boolean, batch: number) => {
    const chunk = readChunkFacts({
      type: 'tool-input', toolName, messageId: 'm1', toolCallId: `call_${batch}`,
      position: { batch, index: 0 },
    })
    if (chunk === null || deliver === undefined) throw new Error('Expected a tool input delivery')
    act(() => deliver?.({ kind: 'chunks', replaying, chunks: [chunk] }))
  }
  emit('studio_browser_open', true, 1)
  emit('studio_browser_quit', false, 2)
  emit('web_search', false, 3)
  expect(reveal).not.toHaveBeenCalled()
  emit('mcp_studio_browser_open', false, 4)
  expect(reveal).toHaveBeenCalledOnce()
})

it('reveals browser work replayed as part of the current streaming submission', () => {
  phase = { status: 'streaming', submissionId: 'current' }
  const reveal = vi.fn()
  renderHook(() => useConversationTranscript('cnv_1', reveal))
  const replay = (submissionId: string, batch: number) => {
    const messageId = `m${batch}`
    const message = readChunkFacts({ type: 'message-started', messageId, submissionId, position: { batch, index: 0 } })
    const call = readChunkFacts({ type: 'tool-input', messageId, toolCallId: messageId,
      toolName: 'mcp__14_studio-browser__19_studio_browser_open', position: { batch, index: 1 } })
    if (!message || !call) throw new Error('Expected a browser call')
    act(() => deliver?.({ kind: 'chunks', replaying: true, chunks: [message, call] }))
  }
  replay('older', 1)
  expect(reveal).not.toHaveBeenCalled()
  replay('current', 2)
  expect(reveal).toHaveBeenCalledOnce()
})
