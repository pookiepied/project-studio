/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APPEARANCE } from '@/design/theme/appearance'
import { AppearancePane } from './AppearancePane'

const update = vi.fn()
const setSidebarOpen = vi.fn()
const applyWindowSize = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/design/theme', async (original) => ({
  ...(await original<typeof import('@/design/theme')>()),
  useAppearance: () => ({ appearance: DEFAULT_APPEARANCE, update, isDefault: true, reset: vi.fn() }),
}))

vi.mock('@/platform/tauri', async (original) => ({
  ...(await original<typeof import('@/platform/tauri')>()),
  applyWindowSize,
}))

vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ setSidebarOpen }) }))

beforeEach(() => {
  vi.useFakeTimers()
  update.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const increase = () => fireEvent.click(screen.getByRole('button', { name: 'Increase UI scale' }))

describe('the window size presets', () => {
  it('offers both sizes, and the sidebar follows the room each one has', async () => {
    render(<AppearancePane />)

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(applyWindowSize).toHaveBeenLastCalledWith('compact')
    await act(async () => {})
    expect(setSidebarOpen).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'Standard' }))
    expect(applyWindowSize).toHaveBeenLastCalledWith('standard')
    await act(async () => {})
    expect(setSidebarOpen).toHaveBeenLastCalledWith(true)
  })
})

describe('the UI scale counter', () => {
  it('shows each step at once and rescales once, when the clicking stops', () => {
    render(<AppearancePane />)

    increase()
    expect(screen.getByText('110%')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(300) })
    increase()
    expect(screen.getByText('125%')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(300) })
    expect(update).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ uiScale: 125 })
  })

  it('still applies a step when the pane is left straight after it', () => {
    const { unmount } = render(<AppearancePane />)

    increase()
    unmount()
    act(() => { vi.runAllTimers() })
    expect(update).toHaveBeenCalledWith({ uiScale: 110 })
  })
})
