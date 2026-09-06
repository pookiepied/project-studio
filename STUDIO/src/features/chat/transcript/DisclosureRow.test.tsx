/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DisclosureRow } from './DisclosureRow'

/**
 * The geometry every secondary row of a reply shares.
 *
 * The load-bearing property is the content boundary: the row's first painted
 * element sits where the reply's prose starts, with nothing of the row's own
 * shifting it sideways. That property cannot be measured here — jsdom
 * computes no stylesheet — so the test pins the one place the rule lives: the
 * class list of the row's button. A `pl-*` utility appearing on it is the
 * four-pixel indent this component exists to have removed, arriving again
 * through the one door that would not trip any other test.
 */

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
})

/** A controlled stand-in for whatever row a caller builds on the primitive. */
function Controlled({
  children,
  ...row
}: {
  children?: ReactNode
  leading?: ReactNode
  disabled?: boolean
  chevron?: 'always' | 'hover'
  entering?: boolean
  flush?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      label="Read 2"
      open={open}
      onToggle={() => setOpen((value) => !value)}
      {...row}
    >
      {children ?? <div>the working-out</div>}
    </DisclosureRow>
  )
}

describe('the content boundary', () => {
  it('carries no left padding on the row', () => {
    render(<Controlled />)
    const button = screen.getByRole('button')
    expect(/\bpl-/.test(button.className)).toBe(false)
  })

  it('is one rule for every leading mark — with one and without', () => {
    // The mark and the mark-less row left the same edge: both buttons come
    // from the one class list, so no caller can realign itself alone.
    render(<Controlled />)
    render(<Controlled leading={<span data-testid="mark" />} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(/\bpl-/.test(buttons[0]?.className ?? '')).toBe(false)
    expect(/\bpl-/.test(buttons[1]?.className ?? '')).toBe(false)
  })
})

describe('the disclosure', () => {
  it('opens behind the rule and reports itself', () => {
    render(<Controlled />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('the working-out')).toBeTruthy()
  })

  it('closes again and reports it', () => {
    render(<Controlled />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps its mark part of the row when the body is the content', () => {
    // The `always` mode carries no hiding classes at all: the mark is part of
    // the row at rest, and its turn when it opens is motion's business, not
    // the class list's.
    const { container } = render(<Controlled />)
    const classes = container.querySelector('button svg.lucide-chevron-right')?.parentElement?.getAttribute('class') ?? ''
    expect(classes).not.toContain('opacity-0')
    expect(classes).not.toContain('opacity-100')
  })
})

describe('the body', () => {
  it('hangs off its row behind a rule', () => {
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button'))
    const body = screen.getByText('the working-out').parentElement
    expect(body?.className).toContain('mt-1.5')
    expect(body?.className).toContain('ml-1.5')
    expect(body?.className).toContain('border-l-2')
    expect(body?.className).toContain('pl-3')
  })

  it('stands flush when the body arrives as its own framed card', () => {
    // The file diff carries its own edge; a rule beside it would draw a
    // second frame around work that already has one.
    render(<Controlled flush />)
    fireEvent.click(screen.getByRole('button'))
    const body = screen.getByText('the working-out').parentElement
    expect(body?.className).toContain('mt-1.5')
    expect(body?.className).not.toContain('ml-1.5')
    expect(body?.className).not.toContain('border-l-2')
    expect(body?.className).not.toContain('pl-3')
  })
})

describe('the quiet disclosure', () => {
  it('is hidden at rest and shown over the row, on focus, and while open', () => {
    const { container } = render(<Controlled chevron="hover" />)
    const mark = container.querySelector('button svg.lucide-chevron-right')?.parentElement
    const classes = mark?.getAttribute('class') ?? ''
    expect(classes).toContain('opacity-0')
    expect(classes).toContain('group-hover/disclosure:opacity-100')
    expect(classes).toContain('group-focus-visible/disclosure:opacity-100')

    fireEvent.click(screen.getByRole('button'))

    expect(mark?.getAttribute('class')).toContain('opacity-100')
  })

  it('is absent entirely on a row with nothing behind it', () => {
    // Not hidden — absent. It sits at the end of the row, so it can appear
    // later without moving the mark or the words to its left, and a row that
    // is a statement carries no promise of an opening.
    const { container } = render(<Controlled disabled chevron="hover" />)
    expect(container.querySelector('button svg.lucide-chevron-right')).toBeNull()
  })
})

describe('a row that is a statement, not a control', () => {
  it('does not open, and does not take hover for an answer', () => {
    render(<Controlled disabled />)
    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)

    fireEvent.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('the working-out')).toBeNull()
  })

  it('still carries the boundary — a statement sits at the same edge', () => {
    render(<Controlled disabled />)
    expect(/\bpl-/.test(screen.getByRole('button').className)).toBe(false)
  })
})

/**
 * The entrance. A short trace that lands whole within a few hundred
 * milliseconds used to pop into the running reply with no transition at all,
 * which read as a flicker rather than as an event. Rows arriving with a live
 * turn enter on the house fade; replayed rows do not arrive twice.
 */
describe('the entrance', () => {
  it('starts on the house fade when the row arrives with a live turn', () => {
    const { container } = render(<Controlled entering />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.opacity).toBe('0')
  })

  it('is already on the page for a row the reader did not watch arrive', () => {
    const { container } = render(<Controlled />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.opacity).not.toBe('0')
  })
})
