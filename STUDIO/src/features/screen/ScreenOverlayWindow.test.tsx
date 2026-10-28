/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScreenOverlayWindow } from './ScreenOverlayWindow'

const monitor = { x: 1920, y: 0, width: 2000, height: 1000, scale: 2 }
const native = vi.hoisted(() => ({
  state: null as unknown,
  drawn: vi.fn(async () => undefined),
  finish: vi.fn(async () => undefined),
  idle: vi.fn(async () => undefined),
}))

vi.mock('@/platform/tauri/screenOverlay', () => ({
  overlayState: async () => native.state,
  onOverlayMarks: async () => () => undefined,
  onOverlayDraw: async () => () => undefined,
  onOverlayReset: async () => () => undefined,
  sendDrawnShapes: native.drawn,
  finishScreenDrawing: native.finish,
  overlayIdle: native.idle,
}))

describe('Studio on the person\'s screen', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('sends each stroke as a shape in desktop pixels, and Done hands back the pointer', async () => {
    native.state = { drawing: { monitor }, marks: null }
    const { container } = render(<ScreenOverlayWindow />)
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Drawing' })).toBeTruthy())
    const canvas = container.querySelector('svg.cursor-crosshair')
    if (canvas === null) throw new Error('no drawing surface')
    canvas.setPointerCapture = () => undefined
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 110, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(native.drawn).toHaveBeenCalledWith([{ shape: 'line', x: 1920 + 20, y: 20, width: 200, height: 4 }])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(native.finish).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Drawing' })).toBeNull())
  })

  it('shows the agent\'s labelled mark where the display puts it, and nothing once it expires', async () => {
    native.state = {
      drawing: null,
      marks: { monitor, set: { id: 's', display: { index: 1, x: 1920, y: 0, width: 2000, height: 1000 }, expiresAt: Date.now() + 60_000, marks: [{ kind: 'point', x: 200, y: 100, label: 'Save' }] } },
    }
    render(<ScreenOverlayWindow />)
    await waitFor(() => expect(screen.getByText('Save')).toBeTruthy())
    native.state = { drawing: null, marks: { monitor, set: { id: 'old', display: { index: 1, x: 1920, y: 0, width: 2000, height: 1000 }, expiresAt: 1, marks: [{ kind: 'point', x: 1, y: 1, label: 'Stale' }] } } }
    cleanup()
    render(<ScreenOverlayWindow />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Stale')).toBeNull()
  })
})
