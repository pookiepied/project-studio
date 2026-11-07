/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const platform = vi.hoisted(() => ({
  tauri: true,
  closeWindow: vi.fn(async () => {}),
  toggleMaximizeWindow: vi.fn(async () => {}),
}))
vi.mock('@/platform/tauri', () => ({
  isTauri: () => platform.tauri,
  closeWindow: platform.closeWindow,
  toggleMaximizeWindow: platform.toggleMaximizeWindow,
}))

import { WindowControls } from './WindowControls'

afterEach(() => {
  cleanup()
  platform.tauri = true
  vi.clearAllMocks()
})

describe('the window controls', () => {
  it('maximizes and closes, and offers no minimize', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(platform.toggleMaximizeWindow).toHaveBeenCalledOnce()
    expect(platform.closeWindow).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull()
  })

  it('draws nothing in a browser, where there is no window to control', () => {
    platform.tauri = false
    render(<WindowControls />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
