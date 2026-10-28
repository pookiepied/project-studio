/**
 * The marks the agent asked to show on the person's screen, read back out of
 * its `studio_computer_mark` answers (ADR 0059).
 *
 * Read defensively out of `unknown`, like every reader of a tool's answer: a
 * shape this code does not know is no marks, never a thrown error in the
 * window that draws them.
 */

export type MarkKind = 'point' | 'ring' | 'box' | 'arrow'

export interface Mark {
  readonly kind: MarkKind
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly toX?: number
  readonly toY?: number
  readonly label?: string
}

export interface MarkDisplay {
  readonly index: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface MarkSet {
  readonly id: string
  readonly display: MarkDisplay
  readonly marks: readonly Mark[]
  readonly expiresAt: number
}

/** What one mark answer asks the drawing window to do. */
export type MarkCommand = { readonly kind: 'show'; readonly set: MarkSet } | { readonly kind: 'clear' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isKind(value: unknown): value is MarkKind {
  return value === 'point' || value === 'ring' || value === 'box' || value === 'arrow'
}

function markOf(value: unknown): Mark | null {
  if (!isRecord(value) || !isKind(value['kind'])) return null
  const x = finite(value['x'])
  const y = finite(value['y'])
  if (x === undefined || y === undefined) return null
  const width = finite(value['width'])
  const height = finite(value['height'])
  const toX = finite(value['toX'])
  const toY = finite(value['toY'])
  const label = typeof value['label'] === 'string' ? value['label'].slice(0, 48) : undefined
  return {
    kind: value['kind'], x, y,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(toX === undefined ? {} : { toX }),
    ...(toY === undefined ? {} : { toY }),
    ...(label === undefined ? {} : { label }),
  }
}

export function parseMarkSet(value: unknown): MarkSet | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !isRecord(value['display']) || !Array.isArray(value['marks'])) return null
  const display = value['display']
  const index = finite(display['index'])
  const x = finite(display['x'])
  const y = finite(display['y'])
  const width = finite(display['width'])
  const height = finite(display['height'])
  const expiresAt = finite(value['expiresAt'])
  if (index === undefined || x === undefined || y === undefined || width === undefined || height === undefined || expiresAt === undefined) return null
  const marks = value['marks'].map(markOf).filter((mark): mark is Mark => mark !== null).slice(0, 6)
  return marks.length === 0 ? null : { id: value['id'], display: { index, x, y, width, height }, marks, expiresAt }
}

/**
 * The command in a mark call's answer. The answer may arrive as the raw MCP
 * result or wrapped by persistence, so the structured part is looked for a
 * few levels down, as `computerCall` does for observations.
 */
export function markCommandOf(output: unknown): MarkCommand | null {
  let value = output
  for (let depth = 0; depth < 3 && isRecord(value); depth += 1) {
    const structured = value['structuredContent']
    if (isRecord(structured) && isRecord(structured['marks'])) {
      const marks = structured['marks']
      if (marks['clear'] === true) return { kind: 'clear' }
      const set = parseMarkSet(marks)
      return set === null ? null : { kind: 'show', set }
    }
    value = value['value'] ?? value['result']
  }
  return null
}
