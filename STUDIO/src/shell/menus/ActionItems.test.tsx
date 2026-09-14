/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDraft } from '@/features/chat/composer/drafts'
import { fieldAt } from '@/lib/field'
import { ActionItems } from './ActionItems'

/**
 * Three lists, each only about the thing that summoned it. What is pinned:
 * a text field gets the field's verbs and none of the app's; a selection
 * gets its three and none of the app's; the page gets the app's; and "Ask
 * about this" carries the selection into the home draft as a quotation.
 */

const goHome = vi.fn()
vi.mock('@/stores/navigation', () => ({
  useNavigation: () => ({
    goHome,
    setPaletteOpen: vi.fn(),
    openSettings: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const labels = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())

/** A textarea with its caret placed, for the field list to read. */
function fieldWith(value: string, from: number, to: number): HTMLTextAreaElement {
  render(<textarea defaultValue={value} />)
  const field = screen.getByRole('textbox')
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
  field.setSelectionRange(from, to)
  return field
}

describe('the action lists', () => {
  it('gives a text field its own verbs and nothing else', () => {
    const field = fieldWith('hello world', 0, 5)
    render(<ActionItems kind="field" selection="" target={field} close={vi.fn()} />)

    expect(labels()).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    expect(screen.queryByText('New conversation')).toBeNull()
    expect(screen.queryByText('Reload interface')).toBeNull()
  })

  it('greys Cut and Copy when the field has no selection', () => {
    const field = fieldWith('hello', 2, 2)
    render(<ActionItems kind="field" selection="" target={field} close={vi.fn()} />)

    const disabled = (name: string) => screen.getByRole('menuitem', { name }).hasAttribute('disabled')
    expect(disabled('Cut')).toBe(true)
    expect(disabled('Copy')).toBe(true)
    expect(disabled('Paste')).toBe(false)
  })

  it('gives a selection its three verbs and none of the app\'s', () => {
    render(<ActionItems kind="selection" selection="three words here" target={null} close={vi.fn()} />)
    expect(labels()).toEqual(['Copy', 'Select all', 'Ask about this'])
  })

  it('gives the page the app\'s verbs', () => {
    render(<ActionItems kind="page" selection="" target={null} close={vi.fn()} />)
    expect(labels()).toEqual(['New conversation', 'Reload interface', 'SearchCtrl K', 'Settings'])
  })

  it('carries the selection home as a quotation, ready for the question', () => {
    const close = vi.fn()
    render(<ActionItems kind="selection" selection={'first line\nsecond line'} target={null} close={close} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask about this' }))

    expect(readDraft(null)).toBe('> first line\n> second line\n\n')
    expect(goHome).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('knows a text field from the rest of the page', () => {
    const { container } = render(
      <div>
        <textarea />
        <input readOnly />
        <p>prose</p>
      </div>,
    )
    expect(fieldAt(container.querySelector('textarea'))).not.toBeNull()
    expect(fieldAt(container.querySelector('input'))).toBeNull()
    expect(fieldAt(container.querySelector('p'))).toBeNull()
  })
})
