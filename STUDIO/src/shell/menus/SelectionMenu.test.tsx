/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SelectionMenu } from './SelectionMenu'

/**
 * Selecting in a transcript raises the toolbar at once. Selecting anywhere else
 * raises nothing: there, the toolbar waits for a right-click.
 */

// jsdom lays nothing out, so the selection has no rectangle of its own.
Range.prototype.getBoundingClientRect = () => new DOMRect(20, 40, 120, 18)

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  cleanup()
})

function select(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  act(() => {
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
}

function page() {
  render(
    <>
      <div data-transcript="cnv_1"><p>from the transcript</p></div>
      <p>from a settings page</p>
      <SelectionMenu />
    </>,
  )
}

describe('the selection toolbar', () => {
  it('offers Copy and Reply in a transcript', () => {
    page()
    select(screen.getByText('from the transcript'))

    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy()
  })

  it('stays out of the way everywhere else', () => {
    page()
    select(screen.getByText('from a settings page'))
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('stays up through a right-click on the selection', () => {
    page()
    select(screen.getByText('from the transcript'))
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    expect(screen.getByRole('toolbar')).toBeTruthy()
  })
})
