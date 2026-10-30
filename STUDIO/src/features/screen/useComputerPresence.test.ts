/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseComputerPresence, useComputerPresence } from './useComputerPresence'

const read = vi.fn()
vi.mock('@/platform/harness', () => ({ resolveHarnessAddress: async () => ({ baseUrl: '', credential: '' }) }))
vi.mock('@/platform/harness/client/request', () => ({ createRequester: () => ({ json: read }) }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('computer presence delivery', () => {
  it('validates the projection and discards foreign content', () => {
    expect(parseComputerPresence({ conversationId: 'chat', mode: 'paused', prompt: 'private' })).toEqual({ conversationId: 'chat', mode: 'paused' })
    for (const value of [null, {}, { conversationId: '', mode: 'active' }, { conversationId: 'chat', mode: 'finished' }]) {
      expect(parseComputerPresence(value)).toBeNull()
    }
  })
  it('shares one poll between consumers, and reports a failed read as unknown', async () => {
    vi.useFakeTimers()
    read.mockResolvedValue({ ok: true, value: { conversationId: 'chat', mode: 'active' } })
    const first = renderHook(() => useComputerPresence())
    const second = renderHook(() => useComputerPresence())
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)
    expect(first.result.current).toEqual(second.result.current)
    expect(first.result.current?.conversationId).toBe('chat')
    read.mockResolvedValue({ ok: false, error: {} })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(first.result.current).toBeNull()
    expect(second.result.current).toBeNull()
  })
  it('rejects a late response from a disposed subscription epoch', async () => {
    let release: ((value: unknown) => void) | undefined
    read.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const old = renderHook(() => useComputerPresence())
    await act(async () => {})
    old.unmount()
    read.mockResolvedValue({ ok: true, value: { conversationId: null, mode: 'active' } })
    const next = renderHook(() => useComputerPresence())
    await act(async () => {})
    await act(async () => { release?.({ ok: true, value: { conversationId: 'old-chat', mode: 'active' } }) })
    expect(next.result.current).toEqual({ conversationId: null, mode: 'active' })
  })
})
