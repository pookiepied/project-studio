import { isRecord } from '@/lib/guards'

/**
 * What a search answers, parsed into the shape the result card reads.
 *
 * The harness answers a search as prose: a grep in `content` mode replies
 * with file blocks of numbered lines, `   197: code` for a hit and
 * `   198- code` for the context around it; `files` mode and glob reply with
 * bare paths; `count` mode with `path: count` rows; and an empty search with
 * a "No matches" sentence. Every mode may trail a `[showing N of M ...]`
 * note. That prose is the model's business, printed verbatim -- but a person
 * opening the row wants the file the hit is in, the line it stands on, and
 * the words that matched, not `in:` and `out:` labels around two slabs of
 * JSON and text. So the card reads this, and anything this cannot read falls
 * back to the slabs: an unparsed answer shown raw is honest, a misparsed one
 * shown structured is a lie.
 *
 * ---- What is not parsed ---------------------------------------------------
 *
 * A multiline content search can carry a match whose text holds a newline,
 * which breaks the one-line-per-row grammar below. Those answers fail the
 * row rule and fall back to raw -- the card never sees them, which is the
 * safe direction: today's rendering for a shape the parser does not know.
 */

export interface SearchQuery {
  readonly toolName: 'grep' | 'glob'
  /** What was looked for: a regex for grep, a file pattern for glob. */
  readonly pattern: string
  /** The directory searched, or null when the whole project was. */
  readonly scope: string | null
  /** The filters worth naming, in the input's own words. */
  readonly filters: readonly string[]
  readonly caseInsensitive: boolean
  readonly multiline: boolean
  /** grep's answer shape; glob always lists files. */
  readonly mode: 'files' | 'content' | 'count'
}

export interface SearchContentLine {
  /** 1-based line in the file. */
  readonly line: number
  readonly text: string
  /** False for a line included only as surrounding context. */
  readonly hit: boolean
}

export interface SearchContentFile {
  readonly path: string
  readonly lines: readonly SearchContentLine[]
  /** The hits only: context lines are shown, not counted. */
  readonly matches: number
}

export interface SearchCountRow {
  readonly path: string
  readonly count: number
}

export type SearchBody =
  | { readonly kind: 'content'; readonly files: readonly SearchContentFile[]; readonly matches: number }
  | { readonly kind: 'files'; readonly paths: readonly string[] }
  | { readonly kind: 'count'; readonly rows: readonly SearchCountRow[]; readonly total: number }
  | { readonly kind: 'none'; readonly sentence: string }

export interface SearchOutcome {
  readonly query: SearchQuery
  readonly body: SearchBody
  /** The harness's trailing note with its brackets off, or null. */
  readonly note: string | null
}

/** grep and glob, the project searches. Anything else is not this card's. */
function searchTool(toolName: string): 'grep' | 'glob' | null {
  return toolName === 'grep' || toolName === 'glob' ? toolName : null
}

/**
 * The call's aim, read from the input the model sent, by field name, never
 * inferred. Null when the input carries no pattern -- without the pattern
 * there is no aim to name, and the card has nothing to stand on.
 */
export function parseSearchQuery(toolName: string, input: unknown): SearchQuery | null {
  const searched = searchTool(toolName)
  if (searched === null || !isRecord(input)) return null
  const pattern = input['pattern']
  if (typeof pattern !== 'string' || pattern === '') return null

  const rawScope = input['path']
  const scope =
    typeof rawScope === 'string' && rawScope !== '' && rawScope !== '.' ? rawScope : null

  const filters: string[] = []
  const glob = input['glob']
  if (typeof glob === 'string' && glob !== '') filters.push(glob)
  const type = input['type']
  if (typeof type === 'string' && type !== '') filters.push(`type: ${type}`)
  if (input['caseInsensitive'] === true) filters.push('case-insensitive')
  if (input['multiline'] === true) filters.push('multiline')

  // The harness defaults an omitted outputMode to `files`; a mode it never
  // named is a shape this cannot read, so the card declines it.
  const mode: SearchQuery['mode'] | null =
    searched === 'glob'
      ? 'files'
      : input['outputMode'] === undefined || input['outputMode'] === 'files'
        ? 'files'
        : input['outputMode'] === 'content'
          ? 'content'
          : input['outputMode'] === 'count'
            ? 'count'
            : null
  if (mode === null) return null

  return {
    toolName: searched,
    pattern,
    scope,
    filters,
    caseInsensitive: input['caseInsensitive'] === true,
    multiline: input['multiline'] === true,
    mode,
  }
}

/** An empty search's sentence, matched whole: a path that merely starts with these words is a path. */
const NONE_SENTENCE = /^No matches\.( .*)?$|^No files matched\.( .*)?$/s

/** The harness's trailing note always opens with one of these words. */
const NOTE_OPEN = /^\[(showing|sorted) /

/** A content row: padded number, `:` for a hit, `-` for context, then the line. */
const MATCH_LINE = /^ *(\d+)([:-]) ?(.*)$/

/** A count row, split on the last colon: a path holds no `: ` on this platform. */
const COUNT_LINE = /^(.*): (\d+)$/

export function parseSearchOutcome(
  toolName: string,
  input: unknown,
  output: string,
): SearchOutcome | null {
  const query = parseSearchQuery(toolName, input)
  if (query === null || typeof output !== 'string') return null
  const text = output.replace(/\r/g, '')
  if (text.trim() === '') return null

  if (NONE_SENTENCE.test(text.trim())) {
    return { query, body: { kind: 'none', sentence: text.trim() }, note: null }
  }

  const blocks = text
    .trim()
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '')

  // The note is the harness's own sentence about the page -- how many more
  // there are, how they sort -- and it travels verbatim, brackets off.
  let note: string | null = null
  const last = blocks[blocks.length - 1]
  if (last !== undefined && NOTE_OPEN.test(last) && last.endsWith(']')) {
    note = last.slice(1, -1)
    blocks.pop()
  }

  if (query.mode === 'content') return contentBody(query, blocks, note)
  if (query.mode === 'count') return countBody(query, blocks, note)
  return filesBody(query, blocks, note)
}

function contentBody(
  query: SearchQuery,
  blocks: readonly string[],
  note: string | null,
): SearchOutcome | null {
  const files: SearchContentFile[] = []
  for (const block of blocks) {
    const rows = block.split('\n')
    const path = rows[0]
    if (path === undefined || path === '' || rows.length < 2) return null
    const lines: SearchContentLine[] = []
    for (const row of rows.slice(1)) {
      const match = MATCH_LINE.exec(row)
      const number = match?.[1]
      const marker = match?.[2]
      const lineText = match?.[3]
      if (number === undefined || marker === undefined || lineText === undefined) return null
      lines.push({ line: Number(number), text: lineText, hit: marker === ':' })
    }
    files.push({
      path,
      lines,
      matches: lines.filter((line) => line.hit).length,
    })
  }
  if (files.length === 0) return null
  return {
    query,
    body: { kind: 'content', files, matches: files.reduce((sum, file) => sum + file.matches, 0) },
    note,
  }
}

function filesBody(
  query: SearchQuery,
  blocks: readonly string[],
  note: string | null,
): SearchOutcome | null {
  // A path list is one slab: a blank line inside it is not a path list.
  if (blocks.length > 1) return null
  const paths = (blocks[0] ?? '').split('\n').filter((line) => line !== '')
  if (paths.some((path) => path.trim() === '')) return null
  return { query, body: { kind: 'files', paths }, note }
}

function countBody(
  query: SearchQuery,
  blocks: readonly string[],
  note: string | null,
): SearchOutcome | null {
  if (blocks.length > 1) return null
  const rows: SearchCountRow[] = []
  for (const line of (blocks[0] ?? '').split('\n').filter((entry) => entry !== '')) {
    const match = COUNT_LINE.exec(line)
    const path = match?.[1]
    const count = match?.[2]
    if (path === undefined || path === '' || count === undefined) return null
    rows.push({ path, count: Number(count) })
  }
  return {
    query,
    body: { kind: 'count', rows, total: rows.reduce((sum, row) => sum + row.count, 0) },
    note,
  }
}

export interface HighlightSpan {
  readonly text: string
  readonly hit: boolean
}

/**
 * Where the pattern lands inside one matched line.
 *
 * The pattern ran on ripgrep's engine, not this one, so a pattern valid
 * there can be nonsense here (`[[:alpha:]]`, `\p{Greek}` without a flag) --
 * and then there is no highlight, not a crash. A line the expression does
 * not touch likewise renders plain: the row already says it matched, and a
 * highlight that cannot point at the words is decoration pretending to be
 * evidence.
 *
 * The lines arrive clipped by the harness (400 characters), which bounds the
 * engine this runs on them.
 */
export function highlightSpans(
  text: string,
  query: Pick<SearchQuery, 'pattern' | 'caseInsensitive' | 'multiline'>,
): readonly HighlightSpan[] | null {
  if (text === '') return null
  let flags = 'g'
  if (query.caseInsensitive) flags += 'i'
  if (query.multiline) flags += 'ms'
  let expression: RegExp
  try {
    expression = new RegExp(query.pattern, flags)
  } catch {
    return null
  }
  const spans: HighlightSpan[] = []
  let cursor = 0
  try {
    for (const match of text.matchAll(expression)) {
      const start = match.index ?? 0
      if (start > cursor) spans.push({ text: text.slice(cursor, start), hit: false })
      // A zero-width match carries no characters: emitting it would print a
      // highlight around nothing, so only the advance matters.
      if (match[0] !== '') spans.push({ text: match[0], hit: true })
      cursor = start + match[0].length
    }
  } catch {
    return null
  }
  if (cursor === 0) return null
  if (cursor < text.length) spans.push({ text: text.slice(cursor), hit: false })
  return spans
}
