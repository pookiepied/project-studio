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
  const { result } = renderHook(() => useQueuedMessages('chat', false))
  await waitFor(() => expect(result.current.messages).toEqual([message]))
  wire.list.mockResolvedValue({ ok: true, value: [] })
  await act(() => result.current.change(message, 'steer'))
  expect(wire.change).toHaveBeenCalledWith('chat', 'queue_steer', 'steer')
  expect(result.current.restoredMessage).toBeNull()
  expect(result.current.messages).toEqual([])
})
