/**
 * Cutting a growing document into a finished part and a live part.
 *
 * Two problems, one answer.
 *
 * The first is cost. Re-parsing a whole reply's markdown on every frame is
 * quadratic in the length of the reply, and it is felt exactly where it hurts
 * most -- the end of a long answer, where the reader is already invested. But
 * text only ever grows at the tail, so everything before the last block is
 * finished and will never change again. Parsed once and memoised, it costs
 * nothing on subsequent frames, and only the block being written is re-parsed.
 *
 * The second is stability. A block that is re-parsed is re-rendered, and a
 * re-rendered code block re-highlights, re-measures, and can visibly reflow.
 * Freezing finished blocks means the paragraphs above the caret are not merely
 * cheap, they are physically the same DOM nodes from one frame to the next.
 *
 * ---- What may and may not be a boundary ----------------------------------
 *
 * A split is only legal where parsing the pieces separately gives the same
 * result as parsing them together. Blank lines between paragraphs, headings and
 * fences qualify. Blank lines *inside* a list or a table do not: split there and
 * an ordered list restarts at 1 and a table loses its header. So blocks of the
 * same continuing family are merged back together, and the whole run is only
 * finished once something of a different kind follows it.
 */

export interface Segments {
  /** Blocks that will never change again, each safe to memoise on its text. */
  readonly stable: readonly string[]
  /** The block currently being written. Empty when the document ends cleanly. */
  readonly tail: string
}

type Kind = 'fence' | 'list' | 'table' | 'quote' | 'plain'

interface Block {
  readonly text: string
  readonly kind: Kind
  /** The fence never closed, so this block cannot be finished. */
  readonly open: boolean
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s/
const TABLE_ROW = /^\s{0,3}\|/
const QUOTE = /^\s{0,3}>/

/**
 * Kinds that continue across a blank line.
 *
 * A loose list is written with blank lines between its items and is still one
 * list. The same goes for a blockquote with a gap in it.
 */
const CONTINUING: ReadonlySet<Kind> = new Set(['list', 'table', 'quote'])

function kindOf(line: string): Kind {
  if (LIST_ITEM.test(line)) return 'list'
  if (TABLE_ROW.test(line)) return 'table'
  if (QUOTE.test(line)) return 'quote'
  return 'plain'
}

/**
 * Close an unterminated fence.
 *
 * This is the fix for code blocks arriving with a jump. While a fence is open
 * the document is, to a markdown parser, an unclosed block -- and parsers vary
 * on what that means mid-document. The visible result is the worst kind of
 * layout change: several lines render as paragraph text, then the closing
 * backticks arrive and the same lines are suddenly a bordered, monospaced,
 * syntax-highlighted panel with a header. Everything below it jumps.
 *
 * Adding the closing fence ourselves makes the block a code block from its very
 * first character. It grows downward from then on, which is a size change with
 * no reflow above it, and the real closing fence when it arrives changes
 * nothing at all.
 */
export function closeOpenFence(text: string): string {
  const lines = text.split('\n')
  let marker: string | null = null

  for (const line of lines) {
    const match = FENCE.exec(line)
    if (!match) continue
    if (marker === null) marker = match[1]
    else if (line.trim().startsWith(marker)) marker = null
  }

  if (marker === null) return text
  return text.endsWith('\n') ? `${text}${marker}` : `${text}\n${marker}`
}

/** Walk the document once, producing blocks with their kind and fence state. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')

  let buffer: string[] = []
  let kind: Kind = 'plain'
  let fence: string | null = null

  const flush = (open: boolean) => {
    if (buffer.length === 0) return
    blocks.push({ text: buffer.join('\n'), kind, open })
    buffer = []
    kind = 'plain'
  }

  for (const line of lines) {
    if (fence !== null) {
      buffer.push(line)
      if (line.trim().startsWith(fence)) {
        fence = null
        flush(false)
      }
      continue
    }

    const opening = FENCE.exec(line)
    if (opening) {
      // A fence starts a block of its own, whatever was being written above it.
      flush(false)
      fence = opening[1]
      kind = 'fence'
      buffer.push(line)
      continue
    }

    if (line.trim() === '') {
      flush(false)
      continue
    }

    if (buffer.length === 0) kind = kindOf(line)
    buffer.push(line)
  }

  // Whatever is left is unfinished by definition: either a fence that never
  // closed, or a paragraph with no blank line after it yet.
  flush(fence !== null)
  return blocks
}

/**
 * Merge runs of the same continuing kind back into one block.
 *
 * Two list blocks separated by a blank line are one list, and splitting them
 * would restart the numbering.
 */
function coalesce(blocks: readonly Block[]): Block[] {
  const merged: Block[] = []

  for (const block of blocks) {
    const previous = merged[merged.length - 1]
    if (previous && previous.kind === block.kind && CONTINUING.has(block.kind)) {
      merged[merged.length - 1] = {
        text: `${previous.text}\n\n${block.text}`,
        kind: block.kind,
        open: block.open,
      }
      continue
    }
    merged.push(block)
  }

  return merged
}

/**
 * Split `text` into finished blocks and the one still being written.
 *
 * `settled` is for a message that is no longer streaming: there is no live tail
 * then, so everything is stable and the last block joins the memoised set
 * rather than re-rendering one final time.
 */
export function segment(text: string, settled: boolean): Segments {
  if (text.length === 0) return { stable: [], tail: '' }

  const blocks = coalesce(blocksOf(text))
  if (blocks.length === 0) return { stable: [], tail: '' }

  if (settled) return { stable: blocks.map((block) => block.text), tail: '' }

  const last = blocks[blocks.length - 1]

  return {
    stable: blocks.slice(0, -1).map((block) => block.text),
    // An open fence is rendered closed, so the block is a code block from its
    // first line rather than becoming one later.
    tail: last.open ? closeOpenFence(last.text) : last.text,
  }
}
