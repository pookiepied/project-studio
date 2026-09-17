import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The theme the browser is told about is the theme the page wears.
 *
 * `publishBrowserTheme` hands the browser two facts - the `color-scheme` and
 * the `theme-color` meta - as plain hex, because the meta travels to parsers
 * that range from full CSS colour support down to bare hex, and a value a
 * browser cannot parse it silently drops. The hex is a second copy of the
 * palette's `--surface`, and a second copy is the kind of pair that drifts:
 * the palette changes, the browser chrome keeps the old ground, and nothing
 * in the app can see it. So this test reads the palette itself and holds the
 * constants in `appearance.ts` against it.
 */

const palettePath = fileURLToPath(new URL('../src/styles/palette.css', import.meta.url))
const appearancePath = fileURLToPath(new URL('../src/design/theme/appearance.ts', import.meta.url))

/** `--surface: oklch(1 0 0)` as written in `styles/palette.css`. */
function surfaceOf(themeBlock: string): { lightness: number; chroma: number } {
  const declaration = themeBlock.match(/--surface:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/)
  if (declaration === null) {
    throw new Error(`--surface is not a plain oklch() value: ${themeBlock.slice(0, 200)}`)
  }
  return { lightness: Number(declaration[1]), chroma: Number(declaration[2]) }
}

/**
 * Grey oklch to sRGB hex.
 *
 * Exact for chroma 0, which is the only kind of surface the palette allows -
 * it is monochrome with no exception, and the chroma assertion below is what
 * keeps this conversion honest about that.
 */
function greyOklchToHex(lightness: number): string {
  const linear = lightness ** 3
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  const channel = Math.round(encoded * 255)
  return `#${channel.toString(16).padStart(2, '0').repeat(3)}`
}

describe('the browser theme mirror', () => {
  const palette = readFileSync(palettePath, 'utf8')
  const lightBlock = palette.match(/:root\s*\{[^}]*\}/)?.[0] ?? ''
  const darkBlock = palette.match(/\.dark\s*\{[^}]*\}/)?.[0] ?? ''

  it('reads both grounds from the palette', () => {
    expect(lightBlock).not.toBe('')
    expect(darkBlock).not.toBe('')
  })

  it('mirrors each ground as the hex the browser chrome is given', () => {
    const light = surfaceOf(lightBlock)
    const dark = surfaceOf(darkBlock)
    // The conversion is exact only for grey; a chromatic surface would make
    // both this assertion and the mirror wrong, so it is named here.
    expect(light.chroma).toBe(0)
    expect(dark.chroma).toBe(0)

    const source = readFileSync(appearancePath, 'utf8')
    expect(source).toContain(`light: '${greyOklchToHex(light.lightness)}'`)
    expect(source).toContain(`dark: '${greyOklchToHex(dark.lightness)}'`)
  })
})
