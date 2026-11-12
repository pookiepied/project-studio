/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerField } from './ComposerField'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('style')
})

describe('composer appearance changes', () => {
  it('keeps six draft lines visible as line height changes without changing the draft', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const root = document.documentElement
    root.style.setProperty('--draft-line-height', '22px')
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element instanceof HTMLTextAreaElement) {
        const style = document.createElement('div').style
        style.lineHeight = root.style.getPropertyValue('--draft-line-height')
        style.paddingTop = '4px'
        style.paddingBottom = '4px'
        return style
      }
      return computedStyle(element)
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const draft = 'Keep all of this draft, including the lines beyond the visible field.'
    render(<ComposerField value={draft} onChange={onChange} onSubmit={onSubmit} placeholder="Reply" />)
    const field = screen.getByRole<HTMLTextAreaElement>('textbox')

    for (const lineHeight of [22, 28, 32, 22]) {
      root.style.setProperty('--draft-line-height', `${lineHeight}px`)
      await waitFor(() => expect(Number.parseFloat(field.style.height)).toBeCloseTo(lineHeight * 6 + 8))
      expect(field.style.overflowY).toBe('auto')
      expect(field.value).toBe(draft)
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('dissolves only the ends that have more text past them', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientHeight', 'get').mockReturnValue(184)
    render(<ComposerField value="A long draft" onChange={vi.fn()} onSubmit={vi.fn()} placeholder="Reply" />)
    const field = screen.getByRole<HTMLTextAreaElement>('textbox')
    const fades = () => [field.style.getPropertyValue('--fade-top'), field.style.getPropertyValue('--fade-bottom')]
    expect(fades()).toEqual(['0px', '14px'])

    field.scrollTop = 5
    fireEvent.scroll(field)
    expect(fades()).toEqual(['5px', '14px'])

    field.scrollTop = 816
    fireEvent.scroll(field)
    expect(fades()).toEqual(['14px', '0px'])
  })

  it('remeasures an existing draft when text size changes without a width change', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const root = document.documentElement
    root.style.setProperty('--ui-size', '11px')
    const lineHeight = () => Number.parseFloat(root.style.getPropertyValue('--ui-size')) * 1.55
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computedStyle(element)
      if (element instanceof HTMLTextAreaElement) style.lineHeight = `${lineHeight()}px`
      return style
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return Math.ceil(this.value.split('\n').length * lineHeight())
    })
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    render(<ComposerField value="Keep my draft" onChange={onChange} onSubmit={onSubmit} placeholder="Reply" />)
    const field = screen.getByRole<HTMLTextAreaElement>('textbox')
    expect(field.style.height).toBe(`${Math.ceil(11 * 1.55)}px`)

    for (const size of [14, 12, 13, 11]) {
      root.style.setProperty('--ui-size', `${size}px`)
      await waitFor(() => expect(field.style.height).toBe(`${Math.ceil(size * 1.55)}px`))
      expect(field.value).toBe('Keep my draft')
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
