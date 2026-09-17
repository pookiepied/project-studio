/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'

import { applyAppearance, DEFAULT_APPEARANCE } from './appearance'

/**
 * What the browser itself is told when the theme moves.
 *
 * Studio's own theme machinery is class-and-variables on the root; the two
 * standard channels beside it - `color-scheme` on the root and the
 * `theme-color` meta - are what the browser's own chrome reads. They must
 * carry the resolved theme (a `system` choice included), update in place on
 * every change, and never duplicate their elements.
 */

afterEach(() => {
  document.head.innerHTML = ''
  document.documentElement.style.colorScheme = ''
  document.documentElement.className = ''
})

function themeColor(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null
}

describe('publishBrowserTheme', () => {
  it('narrows color-scheme to the resolved theme and wears its ground', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(themeColor()).toBe('#171717')

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'light' })
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(themeColor()).toBe('#ffffff')
  })

  it('resolves a system choice through the media query before publishing', () => {
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes('dark'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'system' })
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(themeColor()).toBe('#171717')
  })

  it('updates the one meta in place instead of adding another', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'light' })
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(themeColor()).toBe('#171717')
  })

  it('keeps an existing meta rather than adding a twin beside it', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'theme-color')
    existing.setAttribute('content', '#123456')
    document.head.appendChild(existing)

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(themeColor()).toBe('#171717')
  })
})
