/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Overlay } from './Overlay'

/**
 * The keyboard cannot leave a modal surface, and lands back where it was.
 *
 * jsdom does not move focus on a Tab keydown the way a browser does, so the
 * wrap is judged at the edges: a Tab on the last control is prevented and
 * focus goes to the first; a Shift+Tab on the first goes to the last. In a
 * browser those are exactly the two presses that would have left.
 */

function Surface({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Overlay open={open} onClose={onClose}>
      <div>
        <button type="button">First</button>
        <button type="button">Second</button>
        <button type="button">Last</button>
      </div>
    </Overlay>
  )
}

afterEach(cleanup)

describe('Overlay', () => {
  it('moves focus into the surface when it opens', async () => {
    render(<Surface open onClose={() => {}} />)
    // A frame late on purpose: the trap waits for the panel's own effects.
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(document.activeElement).toBe(screen.getByText('First'))
  })

  it('wraps Tab at the last control and Shift+Tab at the first', () => {
    render(<Surface open onClose={() => {}} />)
    const first = screen.getByText('First')
    const last = screen.getByText('Last')

    last.focus()
    const forward = fireEvent.keyDown(document, { key: 'Tab' })
    expect(forward).toBe(false)
    expect(document.activeElement).toBe(first)

    const backward = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(backward).toBe(false)
    expect(document.activeElement).toBe(last)
  })

  it('returns focus to the opener when it closes', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { rerender } = render(<Surface open onClose={() => {}} />)
    screen.getByText('Second').focus()
    expect(document.activeElement).not.toBe(opener)

    rerender(<Surface open={false} onClose={() => {}} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
