/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScreenWakeLock } from './useScreenWakeLock'

/** A stand-in for the platform's wake lock: each request is one sentinel. */
function installWakeLock() {
  const sentinels: { released: boolean; release: () => Promise<void> }[] = []
  const request = vi.fn(async () => {
    const sentinel = {
      released: false,
      release: async () => { sentinel.released = true },
    }
    sentinels.push(sentinel)
    return sentinel
  })
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  return { request, sentinels }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock')
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useScreenWakeLock', () => {
  it('keeps the screen on while active, and lets it go when voice ends', async () => {
    const { request, sentinels } = installWakeLock()
    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), { initialProps: { active: true } })
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')
    expect(sentinels[0]?.released).toBe(false)

    rerender({ active: false })
    await act(async () => {})
    expect(sentinels[0]?.released).toBe(true)
  })

  it('asks again when the page comes back, since the platform drops it when hidden', async () => {
    const { request, sentinels } = installWakeLock()
    renderHook(() => useScreenWakeLock(true))
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)

    // The platform releases the lock itself when the page is hidden.
    const first = sentinels[0]
    if (first) first.released = true
    await act(async () => setVisibility('hidden'))
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => setVisibility('visible'))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does nothing while inactive, or where the browser has no wake lock', async () => {
    const { request } = installWakeLock()
    renderHook(() => useScreenWakeLock(false))
    await act(async () => {})
    expect(request).not.toHaveBeenCalled()

    Reflect.deleteProperty(navigator, 'wakeLock')
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow()
  })

  it('a refusal leaves voice working', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn(async () => { throw new DOMException('battery saver', 'NotAllowedError') }) },
      configurable: true,
    })
    renderHook(() => useScreenWakeLock(true))
    await act(async () => {})
  })
})
