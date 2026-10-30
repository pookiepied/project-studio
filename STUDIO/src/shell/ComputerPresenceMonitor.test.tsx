/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerPresenceMonitor } from './ComputerPresenceMonitor'
import type { ComputerPresence } from '@/features/screen/useComputerPresence'

let presence: ComputerPresence | null = null
let handler: ((id: string, requestId: string) => void) | undefined
const show = vi.fn().mockResolvedValue(undefined)
const hide = vi.fn().mockResolvedValue(undefined)
const stop = vi.fn().mockResolvedValue({ ok: true })
const report = vi.fn().mockResolvedValue(undefined)
const abort = vi.fn().mockResolvedValue({ ok: true })
const cancel = vi.fn().mockResolvedValue({ ok: true })
const questionStop = vi.fn().mockResolvedValue({ ok: true })
const cancelApproval = vi.fn().mockResolvedValue({ ok: true })
const read = vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'child', agentName: 'general', owner: 'worker' }] })
vi.mock('@/features/screen/useComputerPresence', () => ({ useComputerPresence: () => presence }))
vi.mock('@/platform/harness', () => ({ resolveHarnessAddress: async () => ({ baseUrl: '', credential: '' }) }))
vi.mock('@/platform/harness/client/request', () => ({ createRequester: () => ({ json: read }) }))
vi.mock('@/platform/harness/conversation', () => ({ createConversationClient: () => ({ abortRun: abort }) }))
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ computer: { stop }, tasks: { cancel },
  questions: { stop: questionStop }, approvals: { cancel: cancelApproval, list: async () => ({ ok: true, value: [
    { id: 'own', conversationId: 'other-chat' }, { id: 'foreign', conversationId: 'keep-running' },
  ] }) },
}) }))
vi.mock('@/platform/tauri', () => ({
  showComputerIndicator: (id: string, mode: string) => show(id, mode), hideComputerIndicator: () => hide(),
  reportComputerStopResult: (id: string, failed: boolean) => report(id, failed),
  onComputerStopRequested: async (next: (id: string, requestId: string) => void) => { handler = next; return () => { handler = undefined } },
}))
afterEach(() => { cleanup(); presence = null; vi.clearAllMocks(); vi.useRealTimers() })

describe('desktop presence ownership', () => {
  it('follows live lease ownership and exit without depending on a mounted chat or transcript', () => {
    const view = render(<ComputerPresenceMonitor />)
    expect(hide).toHaveBeenCalledOnce()
    presence = { conversationId: 'background-chat', mode: 'active' }
    view.rerender(<ComputerPresenceMonitor />)
    expect(show).toHaveBeenLastCalledWith('background-chat', 'active')
    presence = { conversationId: 'background-chat', mode: 'paused' }
    view.rerender(<ComputerPresenceMonitor />)
    expect(show).toHaveBeenLastCalledWith('background-chat', 'paused')
    presence = { conversationId: null, mode: 'active' }
    view.rerender(<ComputerPresenceMonitor />)
    expect(hide).toHaveBeenCalledTimes(2)
  })
  it('renews the native sign and clears it when the connection becomes unknown', () => {
    vi.useFakeTimers()
    presence = { conversationId: 'chat', mode: 'active' }
    const view = render(<ComputerPresenceMonitor />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(show).toHaveBeenCalledTimes(3)
    presence = null
    view.rerender(<ComputerPresenceMonitor />)
    const count = show.mock.calls.length
    act(() => { vi.advanceTimersByTime(2000) })
    expect(show).toHaveBeenCalledTimes(count)
    expect(hide).toHaveBeenCalledOnce()
  })
  it('stops the addressed driver, run and owning worker even when that chat is not open', async () => {
    render(<ComputerPresenceMonitor />)
    await act(async () => { handler?.('other-chat', 'press_1') })
    expect(stop).toHaveBeenCalledWith('other-chat')
    expect(abort).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith('worker')
    expect(questionStop).toHaveBeenCalledWith('other-chat')
    expect(cancelApproval.mock.calls).toEqual([['own']])
    expect(report).toHaveBeenCalledWith('press_1', false)
  })
  it('returns a failed stop result to the originating button without claiming exit', async () => {
    stop.mockResolvedValueOnce({ ok: false })
    render(<ComputerPresenceMonitor />)
    await act(async () => { handler?.('other-chat', 'press_2') })
    expect(report).toHaveBeenCalledWith('press_2', true)
  })
})
