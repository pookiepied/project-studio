/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Popover } from './Popover'

/**
 * A dismissal you can actually watch.
 *
 * The menu was already mounted for the whole of its exit and the exit was
 * already running - and it still read as cutting out, because the house
 * ease-out is front-loaded. Two frames into a 180ms departure the panel had
 * been taken to 38% opacity and all but the last 2% of its scale; the other
 * 145ms animated something nobody could see. Duration was not the lever, and
 * neither was anything structural.
 *
 * So what is pinned here is the early part of the curve, which is the only
 * part a person experiences on a departure: shortly after the click the panel
 * must still be substantially there, on its way out rather than already gone.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Framer drives on rAF; this lets real frames elapse rather than faking a clock. */
function frames(count: number) {
  return act(async () => {
    for (let i = 0; i < count; i += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(null))
      })
    }
  })
}

function Harness({ maxHeight }: { maxHeight?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      maxHeight={maxHeight}
      trigger={
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <p>a row</p>
    </Popover>
  )
}

describe('a popover being dismissed', () => {
  it('is still on screen and still leaving a couple of frames in', async () => {
    render(<Harness />)
    await frames(4)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })
    await frames(2)

    const leaving = screen.queryByRole('menu')
    expect(leaving).not.toBeNull()

    // Under the old curve this read 0.38 - the departure was over before it
    // was seen. It has begun (so the animation is running at all) and has not
    // yet spent itself.
    const opacity = Number((leaving as HTMLElement).style.opacity)
    expect(opacity).toBeGreaterThan(0.8)
    expect(opacity).toBeLessThan(1)
  })
})

describe('a popover in a constrained viewport', () => {
  it('keeps an adjacent panel inside the popover and replaces it when space runs out', () => {
    vi.stubGlobal('innerWidth', 900)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(256)
    const onOpenChange = vi.fn()
    render(
      <Popover
        open
        onOpenChange={onOpenChange}
        initialFocus='[type="search"]'
        trigger={<button type="button" aria-haspopup="menu">Open picker</button>}
        companion={{
          label: 'Providers',
          anchor: '[data-browse]',
          content: <button type="button" data-companion-focus>Back to picker</button>,
        }}
      >
        <input type="search" aria-label="Search" />
        <button type="button" data-browse>Browse</button>
      </Popover>,
    )

    const main = screen.getByRole('menu', { name: '' })
    const providers = screen.getByRole('menu', { name: 'Providers' })
    const back = screen.getByRole('button', { name: 'Back to picker' })
    expect(parseFloat(providers.style.left)).toBeGreaterThan(parseFloat(main.style.left) + 256)
    expect(document.activeElement).toBe(back)
    fireEvent.pointerDown(back)
    expect(onOpenChange).not.toHaveBeenCalled()

    vi.stubGlobal('innerWidth', 390)
    fireEvent(window, new Event('resize'))
    expect(main.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(providers.style.left).toBe(main.style.left)

    fireEvent.keyDown(back, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open picker' }))
  })

  it('preserves a caller cap as well as the viewport bound', () => {
    vi.stubGlobal('innerHeight', 1000)
    render(<Harness maxHeight="28rem" />)
    expect(screen.getByRole('menu').style.maxHeight).toBe('min(28rem, 984px)')
  })

  it('limits the scrollable panel and updates its bounds while it remains open', () => {
    vi.stubGlobal('innerWidth', 420)
    vi.stubGlobal('innerHeight', 320)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    render(<Harness />)
    const menu = screen.getByRole('menu')
    expect(menu.style.maxWidth).toBe('404px')
    expect(menu.style.maxHeight).toBe('304px')
    expect(menu.classList.contains('studio-floating-surface')).toBe(true)
    vi.stubGlobal('innerHeight', 240)
    fireEvent(window, new Event('resize'))
    expect(menu.style.maxHeight).toBe('224px')
    expect(menu.style.top).toBe('8px')
  })
})
