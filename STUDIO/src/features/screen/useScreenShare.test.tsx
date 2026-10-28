/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScreenShare } from './useScreenShare'

const ok = <T,>(value: T) => ({ ok: true as const, value })
const computer = {
  share: vi.fn(async (_id: string, on: boolean) => ok(on)),
  control: vi.fn(async () => ok(undefined)),
  glance: vi.fn(async () => ok(undefined)),
}
const platform = vi.hoisted(() => ({
  reset: vi.fn(async () => undefined),
  draw: vi.fn(async () => undefined),
}))

vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ computer }) }))
vi.mock('@/platform/tauri', () => ({
  isTauri: () => true,
  resetScreenOverlay: platform.reset,
  startScreenDrawing: platform.draw,
  onScreenDrawingFinished: async () => () => undefined,
}))

describe('the call\'s screen switches', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('asks for a picture as speech ends only while the screen is shared', async () => {
    const { result } = renderHook(() => useScreenShare('cnv_1', true))
    act(() => result.current.onSpeechEnd())
    expect(computer.glance).not.toHaveBeenCalled()
    await act(async () => { await result.current.toggle() })
    expect(result.current.sharing).toBe(true)
    act(() => result.current.onSpeechEnd())
    expect(computer.glance).toHaveBeenCalledWith('cnv_1')
  })

  it('holds the agent back before putting a pen on the screen, and only while sharing', async () => {
    const { result } = renderHook(() => useScreenShare('cnv_1', true))
    await act(async () => { await result.current.showMe() })
    expect(computer.control).not.toHaveBeenCalled()
    await act(async () => { await result.current.toggle() })
    await act(async () => { await result.current.showMe() })
    expect(computer.control).toHaveBeenCalledWith('cnv_1', 'demonstrate')
    expect(platform.draw).toHaveBeenCalledWith('cnv_1')
    expect(computer.control.mock.invocationCallOrder[0]).toBeLessThan(platform.draw.mock.invocationCallOrder[0] ?? 0)
    expect(result.current.showing).toBe(true)
  })

  it('ends sharing, the drawing and the hold when the call closes', async () => {
    const { result, rerender } = renderHook(({ open }) => useScreenShare('cnv_1', open), { initialProps: { open: true } })
    await act(async () => { await result.current.toggle() })
    await act(async () => { await result.current.showMe() })
    computer.control.mockClear()
    rerender({ open: false })
    expect(computer.share).toHaveBeenLastCalledWith('cnv_1', false)
    expect(platform.reset).toHaveBeenCalled()
    expect(computer.control).toHaveBeenCalledWith('cnv_1', 'resume')
    expect(result.current.sharing).toBe(false)
  })

  it('says why sharing did not turn on, and stays off', async () => {
    computer.share.mockResolvedValueOnce({ ok: false, error: { message: 'Screen sharing is unavailable.' } } as never)
    const { result } = renderHook(() => useScreenShare('cnv_1', true))
    await act(async () => { await result.current.toggle() })
    expect(result.current.sharing).toBe(false)
    expect(result.current.note).toBe('Screen sharing is unavailable.')
  })
})
