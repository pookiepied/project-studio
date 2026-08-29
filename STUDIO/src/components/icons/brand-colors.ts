/**
 * The colour a vendor's mark wears.
 *
 * ---- Why marks have colour now ---------------------------------------------
 *
 * Every mark in this app was one colour - `currentColor` - which read as one
 * list but also made thirty different vendors visually identical. The user
 * asked for the vendors' real colours, and the honest source for those is
 * Simple Icons' own `hex` per brand: the industry-standard single-colour
 * rendition, not a guess. The real logos the harness serves (models.dev) are
 * monochrome `currentColor` SVGs by design, so colour is applied at render:
 * the logo's shape becomes a mask, the brand colour becomes the fill.
 *
 * ---- Why some vendors have none --------------------------------------------
 *
 * A handful of brands are effectively black - Anthropic, Moonshot, GitHub
 * Copilot - and near-black on a dark theme is a mark that vanishes. Rather
 * than lighten a brand into a colour it does not own, those resolve to
 * `undefined` and the mark wears the theme's foreground: black on light,
 * near-white on dark, which is how those brands actually ship their logos.
 * Unknown vendors resolve the same way. `undefined` is therefore a real
 * answer - "wear the theme" - not a failure.
 */

/** Known brand colours, keyed by the ids vendors actually arrive under -
 * a catalog author (`mistralai`, from OpenRouter's model ids), a
 * `catalogProvider`, or a library id. Entries whose brand is effectively
 * black are left out on purpose; see above. */
const BRAND_COLORS: Readonly<Record<string, string>> = {
  google: '#4285F4',
  meta: '#0467DF',
  deepseek: '#5786FE',
  mistral: '#FA520F',
  mistralai: '#FA520F',
  openrouter: '#94A3B8',
  nvidia: '#76B900',
  qwen: '#6950EF',
  alibaba: '#FF6A00',
  minimax: '#E73562',
  perplexity: '#1FB8CD',
  huggingface: '#FFD21E',
}

/** Perceived luminance on 0..1, from the sRGB channels. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const [r, g, b] = channels
  if (r === undefined || g === undefined || b === undefined) return 1
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Below this a colour is "effectively black" for these purposes. */
const NEAR_BLACK = 0.16

/**
 * The brand colour for one vendor id, or `undefined` to wear the theme.
 * Also refuses colours that would vanish on a dark background, whatever
 * table they came from.
 */
export function brandColorFor(provider: string): string | undefined {
  const hex = BRAND_COLORS[provider]
  if (hex === undefined) return undefined
  return luminance(hex) < NEAR_BLACK ? undefined : hex
}
