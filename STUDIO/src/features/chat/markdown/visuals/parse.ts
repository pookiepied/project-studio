/**
 * The visuals a reply can draw, read off a fence.
 *
 * A reply asks for a visual by writing a fence named for it -- ```chart,
 * ```stats, ```progress, ```timeline, ```cards -- holding a small JSON
 * document. Studio draws it in its own style; the model never writes code
 * that runs. The shapes are deliberately forgiving where a model is likely
 * to vary (a number written as a string, a single series written as
 * `data`), and strict where a guess would draw something false.
 *
 * Three outcomes, as with artifacts: a visual, a document still arriving
 * (said nothing about, it is most of a streamed fence's life), or a
 * document that is complete and cannot be drawn -- which the caller shows
 * as the text it is, so nothing the model wrote is lost.
 */

import { StudioError } from '@/lib/errors'

export const VISUAL_FENCES: ReadonlySet<string> = new Set(['chart', 'stats', 'progress', 'timeline', 'cards'])

/** Eight hues, in order; a ninth series is not invented (see `--series-*`). */
export const MAX_SERIES = 8
const MAX_POINTS = 400
const MAX_ITEMS = 24

export interface Series { readonly name: string; readonly values: readonly (number | null)[] }

export interface ChartVisual {
  readonly kind: 'chart'
  readonly type: 'line' | 'area' | 'column' | 'bar'
  readonly title?: string
  readonly subtitle?: string
  readonly x: readonly string[]
  readonly series: readonly Series[]
  readonly unit?: string
  readonly source?: string
}

export interface Stat {
  readonly label: string
  readonly value: string
  readonly delta?: string
  /** Which way the delta reads: as good news, bad news, or neither. */
  readonly tone: 'good' | 'bad' | 'neutral'
  readonly note?: string
}
export interface StatsVisual { readonly kind: 'stats'; readonly title?: string; readonly items: readonly Stat[] }

export interface ProgressItem { readonly label: string; readonly value: number; readonly max: number; readonly note?: string }
export interface ProgressVisual { readonly kind: 'progress'; readonly title?: string; readonly items: readonly ProgressItem[] }

export interface TimelineItem {
  readonly title: string
  readonly date?: string
  readonly detail?: string
  readonly status: 'done' | 'current' | 'upcoming'
}
export interface TimelineVisual { readonly kind: 'timeline'; readonly title?: string; readonly items: readonly TimelineItem[] }

export interface Card {
  readonly title: string
  readonly subtitle?: string
  readonly image?: string
  readonly url?: string
  readonly price?: string
  readonly rating?: number
  readonly detail?: string
  readonly tags: readonly string[]
}
export interface CardsVisual { readonly kind: 'cards'; readonly title?: string; readonly items: readonly Card[] }

export type Visual = ChartVisual | StatsVisual | ProgressVisual | TimelineVisual | CardsVisual

export type VisualResult =
  | { readonly kind: 'visual'; readonly visual: Visual }
  | { readonly kind: 'pending' }
  | { readonly kind: 'invalid'; readonly message: string }

class Invalid extends StudioError {
  constructor(message: string) { super('invalid_visual', message) }
}

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function required(value: unknown, what: string): string {
  const found = text(value)
  if (found === undefined) throw new Invalid(`${what} is missing`)
  return found
}

/** A number, or a numeric string a model quoted ("1,204", "12.5%"). */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[,\s%$\u20ac\u00a3\u00a5]/g, '').replace(/^\u2212/, '-')
  if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null
  return Number(cleaned)
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Invalid(`${what} needs at least one entry`)
  return value
}

function items(document: Json): unknown[] {
  const found = list(document.items, 'items')
  if (found.length > MAX_ITEMS) throw new Invalid(`at most ${MAX_ITEMS} items`)
  return found
}

function chart(document: Json): ChartVisual {
  const type = document.type ?? 'line'
  if (type !== 'line' && type !== 'area' && type !== 'column' && type !== 'bar') {
    throw new Invalid('type is one of line, area, column, bar')
  }
  let x: string[]
  let series: Series[]
  if (document.series === undefined && Array.isArray(document.data)) {
    // The single-series shorthand: [{ "label": "Mon", "value": 3 }, ...].
    const rows = list(document.data, 'data').map((row, index) => {
      if (!isRecord(row)) throw new Invalid(`data row ${index + 1} is not an object`)
      return { label: required(row.label ?? row.x ?? row.name, `data row ${index + 1}'s label`), value: numeric(row.value ?? row.y) }
    })
    x = rows.map((row) => row.label)
    series = [{ name: text(document.name) ?? text(document.title) ?? 'Value', values: rows.map((row) => row.value) }]
  } else {
    x = list(document.x ?? document.labels, 'x').map((label, index) => required(label, `x label ${index + 1}`))
    series = list(document.series, 'series').map((entry, index) => {
      if (!isRecord(entry)) throw new Invalid(`series ${index + 1} is not an object`)
      const values = list(entry.values ?? entry.data, `series ${index + 1}'s values`).map(numeric)
      if (values.length !== x.length) throw new Invalid(`series ${index + 1} has ${values.length} values for ${x.length} labels`)
      return { name: text(entry.name) ?? `Series ${index + 1}`, values }
    })
  }
  if (series.length > MAX_SERIES) throw new Invalid(`at most ${MAX_SERIES} series`)
  if (x.length > MAX_POINTS) throw new Invalid(`at most ${MAX_POINTS} points`)
  if (series.every((entry) => entry.values.every((value) => value === null))) throw new Invalid('no numeric values')
  return {
    kind: 'chart', type, x, series,
    title: text(document.title), subtitle: text(document.subtitle),
    unit: text(document.unit), source: text(document.source),
  }
}

function tone(delta: string | undefined, good: unknown): Stat['tone'] {
  if (delta === undefined) return 'neutral'
  const direction = /^\s*[-\u2212\u2193]/.test(delta) ? 'down' : /^\s*[+\u2191]/.test(delta) ? 'up' : null
  if (direction === null || good === 'neither' || good === 'none') return 'neutral'
  return direction === (good === 'down' ? 'down' : 'up') ? 'good' : 'bad'
}

function stats(document: Json): StatsVisual {
  return {
    kind: 'stats',
    title: text(document.title),
    items: items(document).map((entry, index) => {
      if (!isRecord(entry)) throw new Invalid(`item ${index + 1} is not an object`)
      const raw = entry.delta ?? entry.change
      const delta = typeof raw === 'number' ? (raw > 0 ? `+${raw}` : String(raw)) : text(raw)
      return {
        label: required(entry.label, `item ${index + 1}'s label`),
        value: required(entry.value, `item ${index + 1}'s value`) + (text(entry.unit) ?? ''),
        delta,
        tone: tone(delta, entry.good),
        note: text(entry.note),
      }
    }),
  }
}

function progress(document: Json): ProgressVisual {
  return {
    kind: 'progress',
    title: text(document.title),
    items: items(document).map((entry, index) => {
      if (!isRecord(entry)) throw new Invalid(`item ${index + 1} is not an object`)
      const value = numeric(entry.value)
      const max = numeric(entry.max) ?? 100
      if (value === null) throw new Invalid(`item ${index + 1}'s value is not a number`)
      if (max <= 0) throw new Invalid(`item ${index + 1}'s max must be above zero`)
      return { label: required(entry.label, `item ${index + 1}'s label`), value, max, note: text(entry.note) }
    }),
  }
}

function timeline(document: Json): TimelineVisual {
  return {
    kind: 'timeline',
    title: text(document.title),
    items: items(document).map((entry, index) => {
      if (!isRecord(entry)) throw new Invalid(`item ${index + 1} is not an object`)
      const status = entry.status === 'done' || entry.status === 'current' ? entry.status : 'upcoming'
      return {
        title: required(entry.title ?? entry.label, `item ${index + 1}'s title`),
        date: text(entry.date), detail: text(entry.detail ?? entry.description), status,
      }
    }),
  }
}

function cards(document: Json): CardsVisual {
  return {
    kind: 'cards',
    title: text(document.title),
    items: items(document).map((entry, index) => {
      if (!isRecord(entry)) throw new Invalid(`item ${index + 1} is not an object`)
      const rating = numeric(entry.rating)
      return {
        title: required(entry.title ?? entry.name, `item ${index + 1}'s title`),
        subtitle: text(entry.subtitle), image: text(entry.image), url: text(entry.url),
        price: text(entry.price), detail: text(entry.detail ?? entry.description),
        rating: rating === null ? undefined : Math.max(0, Math.min(5, rating)),
        tags: Array.isArray(entry.tags) ? entry.tags.flatMap((tag) => text(tag) ?? []).slice(0, 4) : [],
      }
    }),
  }
}

const READERS: Record<string, (document: Json) => Visual> = { chart, stats, progress, timeline, cards }

export function parseVisual(fence: string, source: string, streaming: boolean): VisualResult {
  let document: unknown
  try {
    document = JSON.parse(source)
  } catch {
    // Unfinished JSON is what a streamed fence is for most of its life.
    return streaming ? { kind: 'pending' } : { kind: 'invalid', message: 'This is not valid JSON' }
  }
  const read = READERS[fence]
  if (read === undefined) return { kind: 'invalid', message: `No visual is called ${fence}` }
  if (!isRecord(document)) return { kind: 'invalid', message: 'The visual must be a JSON object' }
  try {
    return { kind: 'visual', visual: read(document) }
  } catch (error) {
    if (error instanceof Invalid) return { kind: 'invalid', message: error.message[0].toUpperCase() + error.message.slice(1) }
    throw error
  }
}

const CURRENCY = new Set(['$', '\u20ac', '\u00a3', '\u00a5', '\u20b9', '\u20a9'])

/** A value as the reader sees it: compact on an axis, whole in a readout. */
export function formatValue(value: number, unit?: string, compact = false): string {
  const number = new Intl.NumberFormat('en', compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 }).format(value)
  if (unit === undefined) return number
  if (CURRENCY.has(unit)) return value < 0 ? `-${unit}${number.slice(1)}` : `${unit}${number}`
  // A percent sign and a magnitude letter ("12K", "3.4bn") sit on the number.
  return unit === '%' || /^(?:[KMBT]|bn|mn)$/.test(unit) ? `${number}${unit}` : `${number} ${unit}`
}
