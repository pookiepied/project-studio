// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useQueuedMessages } from './useQueuedMessages'

const wire = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn(), edit: vi.fn() }))
vi.mock('@/platform/harness', () => ({
  resolveHarnessAddress: async () => ({ baseUrl: '', credential: '' }),
  createHarnessClient: () => ({ queuedMessages: wire.list, changeQueuedMessage: wire.change, editQueuedMessage: wire.edit }),
}))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('restores words and images only after the runtime accepts removal for editing', async () => {
  const message = { submissionId: 'queue_edit', text: 'original', images: [{ type: 'image' as const, data: 'YWJj', mimeType: 'image/png' }] }
  wire.list.mockResolvedValue({ ok: true, value: [message] })
  wire.edit.mockResolvedValue({ ok: false, error: { message: 'Already started' } })
  const { result } = renderHook(() => useQueuedMessages('chat', false))
  await waitFor(() => expect(result.current.messages).toEqual([message]))
  await act(() => result.current.change(message, 'edit'))
  expect(result.current.restoredMessage).toBeNull()
  expect(result.current.messages).toEqual([message])
  expect(result.current.error).toBe('Already started')
  wire.edit.mockResolvedValue({ ok: true, value: message })
  wire.list.mockResolvedValue({ ok: true, value: [] })
  await act(() => result.current.change(message, 'edit'))
  expect(wire.edit).toHaveBeenLastCalledWith('chat', 'queue_edit')
  expect(result.current.messages).toEqual([])
  expect(result.current.restoredMessage).toEqual(message)
})

it('promotes the existing submission instead of admitting another message', async () => {
  const message = { submissionId: 'queue_steer', text: 'correction', images: [] }
  wire.list.mockResolvedValue({ ok: true, value: [message] })
  wire.change.mockResolvedValue({ ok: true })
  const steered = vi.fn()
  const { result } = renderHook(() => useQueuedMessages('chat', false, steered))
  await waitFor(() => expect(result.current.messages).toEqual([message]))
  wire.list.mockResolvedValue({ ok: true, value: [] })
  await act(() => result.current.change(message, 'steer'))
  expect(wire.change).toHaveBeenCalledWith('chat', 'queue_steer', 'steer')
  expect(result.current.restoredMessage).toBeNull()
  expect(result.current.messages).toEqual([])
  expect(steered).toHaveBeenCalledExactlyOnceWith(message)
})

it('keeps a refused promotion visible and never announces it as delivered', async () => {
  const message = { submissionId: 'refused', text: 'Keep me', images: [] }
  wire.list.mockResolvedValue({ ok: true, value: [message] })
  wire.change.mockResolvedValue({ ok: false, error: { message: 'Already started' } })
  const steered = vi.fn()
  const { result } = renderHook(() => useQueuedMessages('chat', false, steered))
  await waitFor(() => expect(result.current.messages).toEqual([message]))
  await act(() => result.current.change(message, 'steer'))
  expect(steered).not.toHaveBeenCalled()
  expect(result.current.messages).toEqual([message])
  expect(result.current.error).toBe('Already started')
})

it('ignores an older empty queue response that arrives after a newer populated response', async () => {
  const message = { submissionId: 'new', text: 'Queued words', images: [] }
  let finishOld: ((value: { ok: true; value: [] }) => void) | undefined
  wire.list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
  wire.list.mockResolvedValue({ ok: true, value: [message] })
  const { result } = renderHook(() => useQueuedMessages('chat', false))
  await waitFor(() => expect(wire.list).toHaveBeenCalledTimes(1))
  await act(() => result.current.refresh())
  expect(result.current.messages).toEqual([message])
  await act(async () => finishOld?.({ ok: true, value: [] }))
  expect(result.current.messages).toEqual([message])
})

it('does not invalidate the new chat queue when an old chat promotion finishes', async () => {
  const oldMessage = { submissionId: 'old', text: 'Old chat', images: [] }
  const newMessage = { submissionId: 'new', text: 'New chat', images: [] }
  let finishChange: ((value: { ok: true }) => void) | undefined
  let finishList: ((value: { ok: true; value: typeof newMessage[] }) => void) | undefined
  wire.list.mockImplementation((id: string) => id === 'old-chat'
    ? Promise.resolve({ ok: true, value: [oldMessage] })
    : new Promise((resolve) => { finishList = resolve }))
  wire.change.mockImplementation(() => new Promise((resolve) => { finishChange = resolve }))
  const steered = vi.fn()
  const { result, rerender } = renderHook((id: string) => useQueuedMessages(id, false, steered), { initialProps: 'old-chat' })
  await waitFor(() => expect(result.current.messages).toEqual([oldMessage]))
  let changing: Promise<void> | undefined
  act(() => { changing = result.current.change(oldMessage, 'steer') })
  await waitFor(() => expect(wire.change).toHaveBeenCalled())
  rerender('new-chat')
  await waitFor(() => expect(wire.list).toHaveBeenCalledWith('new-chat'))
  await act(async () => { finishChange?.({ ok: true }); await changing })
  await act(async () => finishList?.({ ok: true, value: [newMessage] }))
  expect(result.current.messages).toEqual([newMessage])
  expect(steered).not.toHaveBeenCalled()
})
