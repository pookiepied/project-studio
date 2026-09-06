/**
 * A line diff between two texts, as the transcript's tool chips expand it.
 *
 * ---- Every row is a fact --------------------------------------------------
 *
 * The rows are derived from exactly the two strings the caller hands over --
 * for a tool call, the two strings the model actually sent. Nothing is
 * inferred about the file, the tool's effect, or what the model meant: a
 * context line is a line both strings share, a removed line is one only the
 * old string had, and an added line is one only the new string has.
 *
 * ---- The honest fallback --------------------------------------------------
 *
 * The minimal edit script costs a table of (old lines) x (new lines) cells.
 * Past a budget the table is not built and every old line is shown removed,
 * every new line added. That is coarser, never wrong: each row is still
 * exactly what was sent, which a guessed shortcut through a table that was
 * never built could not promise.
 *
 * ---- Line numbers are never invented here ---------------------------------
 *
 * The builder itself numbers nothing but a whole-file write -- its content
 * IS lines 1..n -- so `wholeFileDiff` numbers its rows. An edit's rows leave
 * this module numberless, because where the changed span sits in the file is
 * nowhere in what the model sent; the harness's own answer does know, and
 * `editOutcome`'s anchoring numbers the rows from that echo, only where the
 * echo corroborates them line for line. `FileDiff` prints gutters only when
 * the rows carry them.
 */

export interface DiffRow {
  readonly type: 'ctx' | 'add' | 'del'
  /** 1-based line in the old text, when the old text is the whole file. */
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
}

export interface LineDiff {
  readonly rows: readonly DiffRow[]
  readonly added: number
  readonly removed: number
}

/**
 * LCS cells the builder may spend. An edit's old and new strings run to
 * hundreds of lines at worst -- well inside this -- and past it the fallback
 * is a statement of the inputs, not a mistake to hide.
 */
const CELL_BUDGET = 500_000

export function diffLines(oldText: string, newText: string): LineDiff {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const withinBudget = (oldLines.length + 1) * (newLines.length + 1) <= CELL_BUDGET
  const rows = withinBudget ? minimalRows(oldLines, newLines) : blockRows(oldLines, newLines)
  return statOf(rows)
}

/**
 * A whole-file write: every line the call sent, numbered, because the
 * content is the file and line n of the content is line n of the file.
 */
export function wholeFileDiff(content: string): LineDiff {
  const rows: DiffRow[] = splitLines(content).map((text, index) => ({
    type: 'add',
    oldLine: null,
    newLine: index + 1,
    text,
  }))
  return statOf(rows)
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  // A trailing newline closes the last line; it does not open an empty one.
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The minimal edit script, by longest common subsequence. Equal lines bind
 * first, so a change reads as the fewest rows that tell the truth about the
 * two strings.
 */
function minimalRows(oldLines: readonly string[], newLines: readonly string[]): DiffRow[] {
  const width = newLines.length + 1
  const table = new Uint32Array((oldLines.length + 1) * width)
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    const oldLine = oldLines[i]
    if (oldLine === undefined) continue
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const newLine = newLines[j]
      if (newLine === undefined) continue
      table[i * width + j] =
        oldLine === newLine
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    const oldLine = oldLines[i]
    const newLine = newLines[j]
    if (oldLine === undefined || newLine === undefined) break
    if (oldLine === newLine) {
      rows.push({ type: 'ctx', oldLine: null, newLine: null, text: oldLine })
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      rows.push({ type: 'del', oldLine: null, newLine: null, text: oldLine })
      i += 1
    } else {
      rows.push({ type: 'add', oldLine: null, newLine: null, text: newLine })
      j += 1
    }
  }
  // Whichever side the walk ran out of keeps its remainder as one block:
  // the rows the LCS left unpaired are removed or added, in order.
  while (i < oldLines.length) {
    const text = oldLines[i]
    if (text === undefined) break
    rows.push({ type: 'del', oldLine: null, newLine: null, text })
    i += 1
  }
  while (j < newLines.length) {
    const text = newLines[j]
    if (text === undefined) break
    rows.push({ type: 'add', oldLine: null, newLine: null, text })
    j += 1
  }
  return rows
}

/** The over-budget fallback: nothing paired, nothing hidden. */
function blockRows(oldLines: readonly string[], newLines: readonly string[]): DiffRow[] {
  return [
    ...oldLines.map((text) => ({ type: 'del' as const, oldLine: null, newLine: null, text })),
    ...newLines.map((text) => ({ type: 'add' as const, oldLine: null, newLine: null, text })),
  ]
}

function statOf(rows: readonly DiffRow[]): LineDiff {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.type === 'add') added += 1
    else if (row.type === 'del') removed += 1
  }
  return { rows, added, removed }
}
