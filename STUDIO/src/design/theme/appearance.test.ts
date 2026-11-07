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
 *
 * In a plain browser the third fact is the canvas: the bars extend the
 * page's ground, the page paints none of it, and the scheme's default - pure
 * black in dark - is what shows instead. The root's background closes that,
 * except under Tauri, where the window owns its own transparency.
 */

afterEach(() => {
  document.head.innerHTML = ''
  document.documentElement.style.colorScheme = ''
  document.documentElement.style.backgroundColor = ''
  document.documentElement.className = ''
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

function themeColor(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null
}

describe('size and typeface preferences', () => {
  it('sets replies in the chosen typeface and scales through the root in a browser', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark', typeface: 'mono', uiScale: 150 })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-reading')).toBe('var(--font-mono)')
    expect(root.style.getPropertyValue('zoom')).toBe('1.5')

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(root.style.getPropertyValue('zoom')).toBe('')
  })

  it('keeps UI scale and text size independent', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark', uiScale: 200 })
    expect(document.documentElement.style.getPropertyValue('--ui-size')).toContain(`${DEFAULT_APPEARANCE.uiSize}px`)
  })
})

describe('publishBrowserTheme', () => {
  it('narrows color-scheme to the resolved theme and wears its ground', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(themeColor()).toBe('#242424')

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
    expect(themeColor()).toBe('#242424')
  })

  it('updates the one meta in place instead of adding another', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'light' })
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(themeColor()).toBe('#242424')
  })

  it('keeps an existing meta rather than adding a twin beside it', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'theme-color')
    existing.setAttribute('content', '#123456')
    document.head.appendChild(existing)

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(themeColor()).toBe('#242424')
  })

  it('paints the canvas in a plain browser, where nothing else holds the ground', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.documentElement.style.backgroundColor).toBe('rgb(36, 36, 36)')

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'light' })
    expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })

  it('leaves the canvas to the window under Tauri, which owns its own transparency', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })

    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(document.documentElement.style.backgroundColor).toBe('')
  })
})
