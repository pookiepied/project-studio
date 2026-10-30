/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useComputerIndicator } from './useComputerIndicator'
import type { ComputerPresence } from '@/features/screen/useComputerPresence'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { present } from '@/platform/harness/contracts/chunks'

let presence: ComputerPresence | null = null
vi.mock('@/features/screen/useComputerPresence', () => ({ useComputerPresence: () => presence }))

const computerStop = vi.fn().mockResolvedValue({ ok: true, value: 'cleanup_confirmed' })
const cancel = vi.fn().mockResolvedValue({ ok: true, value: true })
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ computer: { stop: computerStop }, tasks: { cancel } }) }))
afterEach(() => { cleanup(); presence = null; vi.clearAllMocks() })

function turnWith(toolName: string): TranscriptItem[] {
  return [{ kind: 'assistant', id: 'msg_1', segments: [{ kind: 'tools', groups: [{ id: 'grp_1', calls: [{
    toolCallId: 'call_1', toolName, input: present({}), output: null, errorText: null,
  }] }] }] }] as unknown as TranscriptItem[]
}

describe('chat computer cleanup', () => {
  it('cleans up a live lease even before its tool call arrives in the transcript', () => {
    presence = { conversationId: 'chat', mode: 'active' }
    const { result } = renderHook(() => useComputerIndicator('chat', [], true, vi.fn()))
    act(() => result.current())
    expect(computerStop).toHaveBeenCalledWith('chat')
  })
  it('joins direct computer cleanup to chat Stop but does not stop the computer for browser-only calls', () => {
    const stop = vi.fn()
    const { result, rerender } = renderHook(({ toolName }) => useComputerIndicator('chat', turnWith(toolName), true, stop), {
      initialProps: { toolName: 'mcp__14_studio-browser__19_studio_browser_open' },
    })
    act(() => result.current())
    expect(computerStop).not.toHaveBeenCalled()
    rerender({ toolName: 'mcp__15_studio-computer__3_studio_computer_type' })
    act(() => result.current())
    expect(computerStop).toHaveBeenCalledWith('chat')
    expect(stop).toHaveBeenCalledTimes(2)
  })
  it('stops an ordinary chat without creating computer work', () => {
    const stop = vi.fn()
    const { result } = renderHook(() => useComputerIndicator('chat', [], true, stop))
    act(() => result.current())
    expect(stop).toHaveBeenCalledOnce()
    expect(computerStop).not.toHaveBeenCalled()
  })
  it('cleans up delegated computer use and cancels its owning voice worker once', () => {
    const stop = vi.fn()
    const { result } = renderHook(() => useComputerIndicator('chat', [], false, stop, [
      { id: 'child', agentName: 'general', owner: 'voice_1' },
      { id: 'voice_1', agentName: 'voice-work' },
    ]))
    act(() => result.current())
    expect(computerStop).toHaveBeenCalledWith('chat')
    expect(cancel.mock.calls).toEqual([['voice_1']])
    expect(stop).toHaveBeenCalledOnce()
  })
})
