/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const platform = vi.hoisted(() => ({
  tauri: true,
  closeWindow: vi.fn(async () => {}),
  minimizeWindow: vi.fn(async () => {}),
  toggleMaximizeWindow: vi.fn(async () => {}),
}))
vi.mock('@/platform/tauri', () => ({
  isTauri: () => platform.tauri,
  closeWindow: platform.closeWindow,
  minimizeWindow: platform.minimizeWindow,
  toggleMaximizeWindow: platform.toggleMaximizeWindow,
}))

import { WindowControls } from './WindowControls'
import { TrafficLights } from './TrafficLights'

afterEach(() => {
  cleanup()
  platform.tauri = true
  vi.clearAllMocks()
})

describe('the window controls', () => {
  it('closes, minimizes and zooms from the reference controls', () => {
    render(<TrafficLights />)
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Close', 'Minimize', 'Zoom'])
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom' }))
    expect(platform.closeWindow).toHaveBeenCalledOnce()
    expect(platform.minimizeWindow).toHaveBeenCalledOnce()
    expect(platform.toggleMaximizeWindow).toHaveBeenCalledOnce()
  })

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
    render(<><WindowControls /><TrafficLights /></>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
