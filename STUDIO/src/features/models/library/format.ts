import type { CatalogModel } from '@/domain/models/catalog'

/**
 * The library's number formatting, in one place.
 *
 * The facts a catalog row carries - context sizes and per-million prices -
 * arrive as raw integers or the wire's own `'unknown'`, and three surfaces
 * print them: a family's rows, a search result's rows, and a model's detail
 * page. The rows want the compact form ("200k", "$3 / $15"); the page wants
 * the exact one ("200,000", "$3.00 / M"). Both come from here so the two can
 * never disagree about what a number is.
 *
 * `'unknown'` is the wire's own word for a dimension the provider never
 * described, and it is not zero. The row answers it with absence - a column
 * of dashes where the point is the models that do name a price is noise -
 * and the page answers it with an em dash, shown rather than hidden, the
 * same answer the wire record gives.
 */

/** Thousands and millions the way a spec sheet prints them: "200k", "1.5M". */
export function contextHint(value: number | 'unknown'): string {
  if (value === 'unknown') return ''
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${trimZeros(millions.toFixed(millions >= 10 ? 0 : 1))}M`
  }
  return `${Math.round(value / 1000)}k`
}

/** The full context figure, commas and all - or the dash for unknown. */
export function contextFull(value: number | 'unknown'): string {
  if (value === 'unknown') return '—'
  return value.toLocaleString('en-US')
}

/** USD per million tokens to two decimals - the detail page's exact form. */
export function priceFull(value: number | 'unknown'): string {
  if (value === 'unknown') return '—'
  return `$${value.toFixed(2)} / M`
}

/**
 * A row's price line: input and output against each other, per million
 * implied - "$3 / $15". Empty when the provider named neither, so a row
 * claims no price it does not know; a single unknown side reads "$3 / -".
 */
export function priceHint(
  input: number | 'unknown',
  output: number | 'unknown',
): string {
  if (input === 'unknown' && output === 'unknown') return ''
  const first = input === 'unknown' ? '—' : `$${compact(input)}`
  const second = output === 'unknown' ? '—' : `$${compact(output)}`
  return `${first} / ${second}`
}

/** Whole dollars stay whole; cents keep two places, trailing zeros dropped. */
function compact(value: number): string {
  if (value >= 100) return String(Math.round(value))
  return trimZeros(value.toFixed(2))
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** The capability words a row can vouch for - the ones that differentiate
 * models inside a family and are confirmed rather than undescribed. Tool
 * calling compresses to "tools"; the dial-level details wait for the page. */
export function rowCapabilities(model: CatalogModel): readonly string[] {
  const words: string[] = []
  if (model.capability.toolCalling === 'supported') words.push('tools')
  if (model.capability.vision === 'supported') words.push('vision')
  if (model.capability.reasoning === 'supported') words.push('reasoning')
  return words
}
