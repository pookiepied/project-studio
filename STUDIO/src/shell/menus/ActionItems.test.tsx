/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearQuote, readQuote } from '@/features/chat/composer/drafts'
import { copyText, readClipboardText } from '@/lib/clipboard'
import { fieldAt } from '@/lib/field'
import { ActionItems } from './ActionItems'

/**
 * Two lists, each only about the thing that summoned it. What is pinned: a text
 * field gets Cut, Copy and Paste; a selection gets Copy, and Reply only in a
 * transcript, which docks it in that conversation's composer.
 */

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn(async () => true),
  readClipboardText: vi.fn(async () => ''),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const labels = () => screen.getAllByRole('button').map((item) => item.textContent?.trim())

/** A textarea with its caret placed, for the field list to read. */
function fieldWith(value: string, from: number, to: number): HTMLTextAreaElement {
  render(<textarea defaultValue={value} />)
  const field = screen.getByRole('textbox')
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
  field.setSelectionRange(from, to)
  return field
}

describe('the action toolbar', () => {
  it('gives a text field its own verbs and nothing else', () => {
    const field = fieldWith('hello world', 0, 5)
    render(<ActionItems kind="field" selection="" target={field} close={vi.fn()} />)
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste'])
  })

  it('greys Cut and Copy when the field has no selection', () => {
    const field = fieldWith('hello', 2, 2)
    render(<ActionItems kind="field" selection="" target={field} close={vi.fn()} />)

    const disabled = (name: string) => screen.getByRole('button', { name }).hasAttribute('disabled')
    expect(disabled('Cut')).toBe(true)
    expect(disabled('Copy')).toBe(true)
    expect(disabled('Paste')).toBe(false)
  })

  it('wakes Cut and Copy when the field gains a selection', () => {
    const field = fieldWith('hello', 2, 2)
    render(<ActionItems kind="field" selection="" target={field} close={vi.fn()} />)
    field.setSelectionRange(0, 5)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(screen.getByRole('button', { name: 'Cut' }).hasAttribute('disabled')).toBe(false)
  })

  it('pastes what the clipboard holds at the caret', async () => {
    vi.mocked(readClipboardText).mockResolvedValueOnce('there')
    const field = fieldWith('hello ', 6, 6)
    const close = vi.fn()
    render(<ActionItems kind="field" selection="" target={field} close={close} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(field.value).toBe('hello there')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('offers only Copy for a selection outside a transcript', () => {
    render(<ActionItems kind="selection" selection="three words here" target={null} close={vi.fn()} />)
    expect(labels()).toEqual(['Copy'])
  })

  it('copies the selection and closes', () => {
    const close = vi.fn()
    render(<ActionItems kind="selection" selection="three words" target={null} close={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(copyText).toHaveBeenCalledWith('three words')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('docks a reply in the composer of the transcript it came from', () => {
    const close = vi.fn()
    const { container } = render(<div data-transcript="cnv_7"><p>said earlier</p></div>)
    const target = container.querySelector('p')
    render(<ActionItems kind="selection" selection="said earlier" target={target} close={close} />)
    expect(labels()).toEqual(['Copy', 'Reply'])

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect(readQuote('cnv_7')).toBe('said earlier')
    expect(close).toHaveBeenCalledTimes(1)
    clearQuote('cnv_7')
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
