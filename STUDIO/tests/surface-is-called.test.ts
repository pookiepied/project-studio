import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The page outlet is called, never rendered.
 *
 * `AppShell` draws the current page with `{Surface({ ... })}` - a function
 * call - and not with `<Surface />`. The note on `Surface` in AppShell.tsx
 * says why at length: rendered as an element, a component whose identity
 * changes between renders is a different component to React, and the whole
 * page unmounts and remounts on every render of the shell - the transcript,
 * every message, the composer. That was the stream stutter that survived
 * five fixes aimed elsewhere, and one well-meant edit brings it back with no
 * type error and no failing render test, because the page still draws. Only
 * the flicker returns.
 *
 * So the file is read as text, the way the palette guard reads the source:
 * the element form must not appear, and the call form must. A reader who
 * moves the outlet keeps both lines true or this says so.
 */
const APP_SHELL = fileURLToPath(new URL('../src/shell/AppShell.tsx', import.meta.url))

describe('the page outlet in AppShell', () => {
  const source = readFileSync(APP_SHELL, 'utf8')

  it('is called as a function', () => {
    expect(source).toMatch(/\{Surface\(\{/)
  })

  it('is never rendered as an element', () => {
    // Prose in the comments names `<Surface />` to explain the rule; only
    // JSX outside a comment is the mistake. Strip the comments first.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/<Surface\b/)
  })
})
