/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaptureMonitor } from './CaptureMonitor'
import type { ClientCaptureState } from '@/platform/diagnostics/transport'

const fixture = vi.hoisted(() => {
  const state: ClientCaptureState = { status: 'off', lastKnownRecording: false }
  return {
    desktop: true,
    state,
    manage: vi.fn(), start: vi.fn(() => () => undefined),
  }
})
vi.mock('@/platform/diagnostics/transport', () => ({
  captureState: () => fixture.state,
  subscribeCapture: () => () => undefined,
  startClientCapture: fixture.start,
}))
vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ openSettings: fixture.manage }) }))
vi.mock('@/platform/tauri', () => ({ isTauri: () => fixture.desktop }))

afterEach(() => { cleanup(); vi.clearAllMocks(); fixture.desktop = true })

describe('visible capture consent state', () => {
  it('keeps the recording indication visible through an outage and opens its controls', () => {
    fixture.state = { status: 'recording', lastKnownRecording: true }
    const view = render(<CaptureMonitor />)
    expect(screen.getByRole('status').textContent).toContain('Local diagnostics recording')
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    expect(fixture.manage).toHaveBeenCalledWith('diagnostics')
    fixture.state = { status: 'unavailable', lastKnownRecording: true }
    view.rerender(<CaptureMonitor />)
    expect(screen.getByRole('status').textContent).toContain('Recording status unavailable')
    fixture.state = { status: 'off', lastKnownRecording: false }
    view.rerender(<CaptureMonitor />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(fixture.start).toHaveBeenCalledOnce()
  })

  it('shows recording in paired browsers and hides a never-recording outage', () => {
    fixture.desktop = false
    fixture.state = { status: 'recording', lastKnownRecording: true }
    const view = render(<CaptureMonitor />)
    expect(screen.getByRole('status')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    fixture.state = { status: 'unavailable', lastKnownRecording: false }
    view.rerender(<CaptureMonitor />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
