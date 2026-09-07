/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

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

afterEach(cleanup)

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

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
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
