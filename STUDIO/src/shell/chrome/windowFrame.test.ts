/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'

import { SHELL } from '@/design/tokens'
import { windowFrame } from './windowFrame'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('the window frame', () => {
  it('is the rounded corner and the hairline on the desktop, where the app is its own window', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })

    const frame = windowFrame()
    expect(frame.style.borderRadius).toBe(SHELL.windowRadius)
    expect(frame.className).toContain('border-hairline')
  })

  it('is nothing in a browser, where the tab is the window', () => {
    const frame = windowFrame()
    expect(frame.style).toEqual({})
    expect(frame.className).toBe('')
  })
})
