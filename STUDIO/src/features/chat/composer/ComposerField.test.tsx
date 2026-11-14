/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerField } from './ComposerField'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('style')
})

describe('composer appearance changes', () => {
  it('measures the first settled width after the parent reserves space for its tools', () => {
    let width = 400
    let resize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = () => {
          const target = screen.getByRole('textbox')
          callback([{
            target,
            contentRect: new DOMRect(0, 0, width, 36),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          }], this)
        }
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return Number.parseFloat(this.style.width) < 300 ? 56 : 36
    })
    render(<ComposerField value="A restored draft near its wrap boundary" onChange={vi.fn()} onSubmit={vi.fn()} placeholder="Reply" />)
    const field = screen.getByRole<HTMLTextAreaElement>('textbox')
    expect(field.style.height).toBe('36px')
    width = 200
    act(resize)
    expect(field.style.height).toBe('56px')
    width = 400
    act(resize)
    expect(field.style.height).toBe('36px')
  })

  it('keeps wrapping stable when the tools move below a wider field', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    let width = 200
    let besideTools = 200
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element instanceof HTMLTextAreaElement) {
        const style = document.createElement('div').style
        style.lineHeight = '20px'
        style.paddingTop = '8px'
        style.paddingBottom = '8px'
        return style
      }
      return computedStyle(element)
    })
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return Number.parseFloat(this.style.width) < 300 ? 56 : 36
    })
    const changed = vi.fn()
    const inlineWidth = () => besideTools
    const props = { onChange: vi.fn(), onSubmit: vi.fn(), placeholder: 'Reply', inlineWidth, onMultilineChange: changed }
    const { rerender } = render(<ComposerField {...props} value="A draft at its wrap boundary" />)
    expect(changed).toHaveBeenLastCalledWith(true)

    width = 400
    rerender(<ComposerField {...props} value="A draft at its wrap boundary." />)
    expect(changed).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').style.height).toBe('36px')

    besideTools = 400
    rerender(<ComposerField {...props} value="A draft at its wrap boundary.." />)
    expect(changed).toHaveBeenLastCalledWith(false)
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

    for (const size of [14, 15, 18, 12, 13, 11]) {
      root.style.setProperty('--ui-size', `${size}px`)
      await waitFor(() => expect(field.style.height).toBe(`${Math.ceil(size * 1.55)}px`))
      expect(field.value).toBe('Keep my draft')
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
