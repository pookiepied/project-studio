/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearQuote, readQuote } from '@/features/chat/composer/drafts'
import { copyText, readClipboardText } from '@/lib/clipboard'
import { fieldAt } from '@/lib/field'
import { suggestionsFor } from '@/lib/spelling'
import { ActionItems } from './ActionItems'
import { ActionsMenu } from './ActionsMenu'

/**
 * Two lists, each only about the thing that summoned it. What is pinned: a text
 * field gets Cut, Copy and Paste; a selection gets Copy, and Reply only in a
 * transcript, which docks it in that conversation's composer.
 */

vi.mock('@/lib/spelling', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/spelling')>()),
  suggestionsFor: vi.fn(async (word: string) => (word === 'umbrela' ? ['umbrella', 'umbrellas'] : [])),
}))

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

  it('offers corrections for a misspelled word and replaces it in place', async () => {
    const value = 'an umbrela today'
    const at = value.indexOf('umbrela') + 2
    const field = fieldWith(value, at, at)
    render(<ActionsMenu />)
    fireEvent.contextMenu(field)

    const fix = await screen.findByRole('button', { name: 'umbrella' })
    expect(labels()).toContain('umbrellas')
    fireEvent.click(fix)
    await waitFor(() => expect(field.value).toBe('an umbrella today'))
  })

  it('offers nothing for a word that is spelled right', async () => {
    const field = fieldWith('an umbrella today', 5, 5)
    render(<ActionsMenu />)
    fireEvent.contextMenu(field)
    await act(async () => {})
    expect(labels()).not.toContain('umbrella')
  })

  it('corrects a selected word through right-click and notifies a controlled field', async () => {
    const onChange = vi.fn()
    function Composer() {
      const [value, setValue] = useState('an umbrela today')
      return <><textarea value={value} onChange={(event) => {
        setValue(event.target.value)
        onChange(event.target.value)
      }} /><ActionsMenu /></>
    }
    render(<Composer />)
    const field = screen.getByRole('textbox')
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
    field.setSelectionRange(3, 11)
    expect(fireEvent.contextMenu(field)).toBe(false)
    expect(screen.getByRole('button', { name: 'Cut' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'umbrella' }))
    expect(field.value).toBe('an umbrella today')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('an umbrella today')
  })

  it('discards old suggestions when reopening on another word in the same field', async () => {
    const field = fieldWith('an umbrela today', 4, 4)
    render(<ActionsMenu />)
    fireEvent.contextMenu(field)
    await screen.findByRole('button', { name: 'umbrella' })

    field.setSelectionRange(13, 13)
    fireEvent.contextMenu(field)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'umbrella' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Paste' })).toBeTruthy()
  })

  it('does not apply a correction to text that changed after the menu opened', async () => {
    const field = fieldWith('an umbrela today', 4, 4)
    render(<ActionsMenu />)
    fireEvent.contextMenu(field)
    const correction = await screen.findByRole('button', { name: 'umbrella' })
    fireEvent.input(field, { target: { value: 'an apple today' } })
    fireEvent.click(correction)
    expect(field.value).toBe('an apple today')
  })

  it('does not check passwords or fields that disable spellcheck', async () => {
    const { container } = render(<>
      <input type="password" defaultValue="umbrela" />
      <textarea spellCheck={false} defaultValue="umbrela" />
      <ActionsMenu />
    </>)
    for (const field of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      field.setSelectionRange(0, 7)
      fireEvent.contextMenu(field)
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    }
    await act(async () => {})
    expect(suggestionsFor).not.toHaveBeenCalled()
  })
})
