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
  it('does not count multiline padding as another line when a draft shrinks', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const computedStyle = window.getComputedStyle.bind(window)
    const style = document.createElement('textarea').style
    style.lineHeight = '12px'
    style.paddingTop = '4px'
    style.paddingBottom = '4px'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
      element instanceof HTMLTextAreaElement ? style : computedStyle(element))
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(20)
    const onMultilineChange = vi.fn()
    render(<ComposerField value="One line" onChange={vi.fn()} onSubmit={vi.fn()}
      onMultilineChange={onMultilineChange} multiline inset={{ left: 0, right: 0 }} placeholder="Reply" />)
    expect(onMultilineChange).toHaveBeenCalledWith(false)
  })

  it('dissolves only the ends that have more text past them', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientHeight', 'get').mockReturnValue(184)
    render(<ComposerField value="A long draft" onChange={vi.fn()} onSubmit={vi.fn()}
      onMultilineChange={vi.fn()} multiline inset={{ left: 0, right: 0 }} placeholder="Reply" />)
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
    render(<ComposerField value="Keep my draft" onChange={onChange} onSubmit={onSubmit}
      onMultilineChange={vi.fn()} multiline={false} inset={{ left: 0, right: 0 }} placeholder="Reply" />)
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
