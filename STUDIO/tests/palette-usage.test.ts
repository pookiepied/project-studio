import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every colour a component names must be a colour the theme defines.
 *
 * This exists because the same defect has shipped twice, silently both times.
 * `text-destructive` was used on four error surfaces and no such token was
 * ever declared, so error text quietly inherited the row's colour instead of
 * turning red. `border-line` was used on the unselected model-level chips
 * with no `--color-line` behind it; that one landed on its feet, because the
 * base layer paints every border with the default token anyway, which is
 * precisely why nobody noticed.
 *
 * Neither could fail loudly on its own. Tailwind emits nothing for a utility
 * it cannot resolve -- no error, no warning, no missing-class report -- so
 * the only signal is a surface that looks slightly wrong to whoever happens
 * to open it in the right palette. A test is the only place this can be
 * caught, so it is caught here, against the stylesheet itself rather than
 * against a list someone has to remember to update.
 *
 * The second rule is about the theme rather than about typos. A raw palette
 * colour (`text-red-500`) resolves perfectly well and is still wrong here:
 * it is one fixed value in an app with two palettes, so it cannot follow the
 * light and dark grounds the way `text-danger` does, and it puts a hue
 * outside the system next to hues inside it.
 */

/**
 * This test lives outside `src` and reads the tree with `node:fs`, the way
 * the harness's own source-scanning tests do. Importing `index.css` from
 * inside the app's module graph does not work for this: the Tailwind plugin
 * is merged into the test config, so it answers with the stylesheet it has
 * compiled rather than the one on disk, and the `@theme` block this reads is
 * exactly what compiling consumes.
 */
const SOURCE_ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const STYLESHEET = fileURLToPath(new URL('../src/index.css', import.meta.url))

/** Every component source, tests left out. */
function sourceFiles(directory: string = SOURCE_ROOT): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue
    if (entry.name.includes('.test.')) continue
    found.push(path)
  }
  return found
}

/** The utility prefixes that take a colour. */
const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'decoration',
  'caret',
  'accent',
  'shadow',
] as const

/**
 * Words that follow a colour prefix without being a colour.
 *
 * Tailwind spends these same prefixes on size, weight, alignment, style and
 * position, and this file's own prose contains hyphenated words that read
 * like utilities. Listing them is duller than trying to be clever about
 * which is which, and a new one arriving is a one-line addition rather than
 * a false failure nobody can explain.
 */
const NOT_COLOURS: ReadonlySet<string> = new Set([
  // Sizes and scales.
  'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full', 'px', 'auto', 'none',
  '0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32',
  // Position and direction, which `border-` and `divide-` and `bg-` all take.
  'l', 'r', 't', 'b', 'x', 'y', 's', 'e', 'left', 'right', 'top', 'bottom',
  'center', 'start', 'end', 'inset', 'offset', 'gradient', 'linear', 'radial', 'conic',
  // Style keywords.
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'separate', 'collapse',
  'spacing', 'clip', 'ellipsis', 'wrap', 'nowrap', 'balance', 'pretty', 'box',
  'opacity', 'width', 'color', 'colour', 'size', 'align', 'anchor', 'rule',
  'transparent', 'current', 'inherit', 'initial', 'unset', 'revert',
  'white', 'black',
  // Typography scale and weight, which share the `text-` prefix.
  'title', 'body', 'caption', 'micro', 'code', 'ui', 'mono', 'sans', 'serif',
  'thin', 'light', 'normal', 'medium', 'semibold', 'bold', 'wide', 'tight',
  'snug', 'loose', 'relaxed', 'super', 'sub', 'baseline', 'middle',
  'justify', 'words', 'all', 'word', 'break', 'spaces', 'only', 'lines',
  // Words that appear in prose next to a prefix.
  'linecap', 'linejoin', 'dasharray', 'relative', 'paired', 'coloured',
  'sized', 'env', 'red', 'green', 'blue',
  // Compound utilities whose first word is a scale or a direction, not a
  // colour: `bg-gradient-to-b`, `border-l-2`, `ring-offset-2`.
  'gradient-to-b', 'gradient-to-t', 'gradient-to-l', 'gradient-to-r',
  'l-2', 'r-2', 't-2', 'b-2', 'spacing-0', 't-transparent', 'offset-2',
  'radius',
])

/** Tailwind's own palette families, which this app does not use directly. */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|divide|outline|decoration|caret|accent|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-(?:50|\d{3})\b/

/**
 * The named values the stylesheet declares to Tailwind.
 *
 * Colours and shadows both, because `shadow-` shares the shape of a colour
 * utility and its tokens go stale the same way. `ring-offset-` is a colour
 * utility whose own scale words are covered in `NOT_COLOURS`.
 */
function declaredValues(): ReadonlySet<string> {
  const css = readFileSync(STYLESHEET, 'utf8')
  const names = new Set<string>()
  for (const match of css.matchAll(/--(?:color|shadow)-([a-z0-9-]+)\s*:/g)) {
    const name = match[1]
    if (name !== undefined) names.add(name)
  }
  return names
}

describe('the colours components are allowed to name', () => {
  it('declares a token for every colour utility the source uses', () => {
    const declared = declaredValues()
    // A guard on the guard: an empty parse would pass everything below.
    expect(declared.size).toBeGreaterThan(15)
    expect(declared.has('danger')).toBe(true)
    expect(declared.has('chip')).toBe(true)

    const pattern = new RegExp(
      `\\b(?:${COLOUR_PREFIXES.join('|')})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`,
      'g',
    )
    const unknown = new Set<string>()
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) {
        const name = match[1]
        if (name === undefined || NOT_COLOURS.has(name)) continue
        // An arbitrary-value utility carries its own colour.
        if (name.startsWith('[')) continue
        // `border-foreground/40` and friends: the token is the part before
        // the slash, and the opacity is Tailwind's own. `ring-offset-surface`
        // colours the offset rather than the ring, so the token is what
        // follows the word.
        const bare = name.startsWith('offset-') ? name.slice('offset-'.length) : name
        const token = bare.split('/')[0] ?? bare
        if (NOT_COLOURS.has(token) || declared.has(token)) continue
        unknown.add(`${match[0]} (${file.slice(SOURCE_ROOT.length)})`)
      }
    }

    expect([...unknown].sort()).toEqual([])
  })

  it('uses no raw palette colour, so every surface follows the theme', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (RAW_PALETTE.test(readFileSync(file, 'utf8'))) {
        offenders.push(file.slice(SOURCE_ROOT.length))
      }
    }
    expect(offenders).toEqual([])
  })
})
