import type { LineDiff } from './diffLines'

/**
 * What the harness answers when a file tool finishes, and the one thing its
 * answer knows that the call's input does not.
 *
 * The answers are a small format. A write replies in sentences -- "Created
 * snake/index.html", or, when it had to make the directory first, a second
 * sentence saying so. An edit replies with its sentence and then echoes the
 * changed span of the file as it stands after the edit, numbered and
 * tab-separated: `   197→function drawFood(now) {`. That echo is where the
 * changed span's position in the file exists at all -- the two strings the
 * model sent know the change but not where it landed -- and it is also a
 * full second copy of the change, which is why the transcript shows the
 * sentence and gives the echo to the diff card instead of printing both.
 */

export interface OutcomeRegionLine {
  /** 1-based line in the file as it stands after the edit. */
  readonly line: number
  readonly text: string
}

export interface FileToolOutcome {
  /** The harness's opening sentence -- "Edited snake/script.js". */
  readonly status: string
  /** Prose past the first line that is not the numbered echo. */
  readonly extra: readonly string[]
  /** The numbered echo, when the answer carries one. Writes do not. */
  readonly region: readonly OutcomeRegionLine[]
}

// The echo's rows are right-aligned numbers and a tab: `   197→code`.
const REGION_LINE = /^\s*(\d+)\t(.*)$/

export function parseFileToolOutcome(value: string): FileToolOutcome | null {
  if (value.trim() === '') return null
  const lines = value.split('\n')
  const status = lines[0] ?? ''
  const extra: string[] = []
  const region: OutcomeRegionLine[] = []
  for (const line of lines.slice(1)) {
    const match = REGION_LINE.exec(line)
    const number = match?.[1]
    const text = match?.[2]
    if (number !== undefined && text !== undefined) {
      region.push({ line: Number(number), text })
    } else if (line.trim() !== '') {
      extra.push(line)
    }
  }
  return { status, extra, region }
}

/**
 * Pins an edit's rows to their real line numbers, using the harness's own
 * echo of the post-edit span.
 *
 * The rule is corroboration, not trust. Every context and added row must
 * stand in the echo, at the very number the walk claims for it -- one line
 * of drift anywhere and nothing is numbered, and the card falls back to the
 * gutterless shape it prints when no position is known. That is why a wrong
 * anchor cannot ship a wrong number: the echo is checked line for line, and
 * when two candidate spans share a text (a repeated line), each is tried
 * until one corroborates the whole walk or none does.
 *
 * A removed row's number is arithmetic rather than echo -- the echo is the
 * file after the edit, so a deleted line's position comes from the rows
 * around it. That arithmetic is exact for a contiguous replacement, which is
 * what an edit is: the old and new strings are one span, and lines before it
 * number alike in both versions.
 */
export function anchorToRegion(diff: LineDiff, region: readonly OutcomeRegionLine[]): LineDiff {
  if (region.length === 0) return diff
  const byLine = new Map<number, string>()
  for (const entry of region) byLine.set(entry.line, entry.text)

  // Any context or added row can hold the anchor -- usually the first, when
  // the echo's span covers the strings from their top, but a model that sent
  // context above the echo's start pins its walk further down.
  for (let index = 0; index < diff.rows.length; index += 1) {
    const row = diff.rows[index]
    if (row === undefined || row.type === 'del' || row.text.trim() === '') continue
    for (const entry of region) {
      if (entry.text.trim() !== row.text.trim()) continue
      const anchored = tryAnchor(diff, index, entry.line, byLine)
      if (anchored !== null) return anchored
    }
  }
  return diff
}

function tryAnchor(
  diff: LineDiff,
  anchorIndex: number,
  anchorLine: number,
  byLine: ReadonlyMap<number, string>,
): LineDiff | null {
  const rows = diff.rows
  let delsBefore = 0
  let addsBefore = 0
  for (let index = 0; index < anchorIndex; index += 1) {
    const row = rows[index]
    if (row?.type === 'del') delsBefore += 1
    if (row?.type === 'add') addsBefore += 1
  }
  // Lines removed before the span push it down; lines added pull it up, so
  // the span's old-file position is its new one shifted by the difference.
  const anchorOldLine = anchorLine + delsBefore - addsBefore

  const numbers = new Array<{ oldLine: number | null; newLine: number | null }>(rows.length)

  let oldNo = anchorOldLine
  let newNo = anchorLine
  for (let index = anchorIndex; index < rows.length; index += 1) {
    const row = rows[index]
    if (row === undefined) break
    if (row.type === 'ctx') {
      if (!corroborates(byLine, newNo, row.text)) return null
      numbers[index] = { oldLine: oldNo, newLine: newNo }
      oldNo += 1
      newNo += 1
    } else if (row.type === 'add') {
      if (!corroborates(byLine, newNo, row.text)) return null
      numbers[index] = { oldLine: null, newLine: newNo }
      newNo += 1
    } else {
      numbers[index] = { oldLine: oldNo, newLine: null }
      oldNo += 1
    }
  }

  oldNo = anchorOldLine
  newNo = anchorLine
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row === undefined) break
    if (row.type === 'ctx') {
      oldNo -= 1
      newNo -= 1
      if (!corroborates(byLine, newNo, row.text)) return null
      numbers[index] = { oldLine: oldNo, newLine: newNo }
    } else if (row.type === 'add') {
      newNo -= 1
      if (!corroborates(byLine, newNo, row.text)) return null
      numbers[index] = { oldLine: null, newLine: newNo }
    } else {
      oldNo -= 1
      numbers[index] = { oldLine: oldNo, newLine: null }
    }
  }

  return {
    rows: rows.map((row, index) => ({ ...row, ...(numbers[index] ?? { oldLine: null, newLine: null }) })),
    added: diff.added,
    removed: diff.removed,
  }
}

/** The echo must carry this exact line at this exact number, whitespace aside. */
function corroborates(byLine: ReadonlyMap<number, string>, line: number, text: string): boolean {
  const echoed = byLine.get(line)
  return echoed !== undefined && echoed.trim() === text.trim()
}
