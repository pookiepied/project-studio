/**
 * Cutting a growing document into a finished part and a live part.
 *
 * Two problems, one answer.
 *
 * The first is cost. Re-parsing a whole reply's markdown on every frame is
 * quadratic in the length of the reply, and it is felt exactly where it hurts
 * most — the end of a long answer, where the reader is already invested. But
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
 * the document is, to a markdown parser, an unclosed block — and parsers vary
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
function closeOpenFence(text: string): string {
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

/**
 * Close inline markup that has been opened and not yet finished.
 *
 * The same argument as `closeOpenFence`, one level down, and it is the reason
 * a reply used to shimmer as it arrived. A paragraph being written is handed
 * to the parser on every frame with its inline syntax half-typed, so the
 * reader watches `**import` sit on screen as literal asterisks, and then the
 * closing `**` lands and the same words become bold. Bold glyphs are wider, so
 * the line re-wraps and everything after it moves. That happens once per
 * emphasis, several times a paragraph.
 *
 * Links are the worst of it: `[the docs](https://example.com/a/long/path` is
 * on screen at full width as ordinary text, and collapses to two words the
 * instant the `)` arrives.
 *
 * Closing the delimiters ourselves means the span is bold - or a link - from
 * its first character and only grows. The real closer, when it comes, changes
 * nothing.
 *
 * ---- What must NOT be closed --------------------------------------------
 *
 * A delimiter is only closed if it could genuinely open emphasis, because the
 * failure here is worse than the problem: `2 * 3` must not go italic halfway
 * through an arithmetic expression, and `snake_case_name` must not either.
 * So this follows CommonMark's flanking rules rather than counting characters
 * - a run that is followed by whitespace cannot open, and `_` additionally
 * cannot open inside a word, which is exactly what makes identifiers safe.
 *
 * An unclosed `[` is left alone. `[text` and `[text]` render identically as
 * literal text, so adding the bracket buys nothing and puts a character on
 * screen that the author did not type.
 */
function closeOpenInline(text: string): string {
  /** Delimiters opened and not yet closed, innermost last. */
  const open: { char: string; run: number }[] = []
  let index = 0

  while (index < text.length) {
    const char = text[index]

    // A backslash escapes whatever follows, including a delimiter.
    if (char === '\\') {
      index += 2
      continue
    }

    // Code spans first, and they win: a delimiter inside one is literal text,
    // so emphasis is not parsed until the span closes.
    if (char === '`') {
      let run = 1
      while (text[index + run] === '`') run += 1
      const close = closingBacktickRun(text, index + run, run)
      if (close === -1) {
        // Unterminated. Everything after it is code, so there is nothing
        // further to parse and the span is the innermost thing open.
        open.push({ char: '`', run })
        break
      }
      index = close + run
      continue
    }

    if (char === '[') {
      open.push({ char: '[', run: 1 })
      index += 1
      continue
    }

    if (char === ']') {
      for (let k = open.length - 1; k >= 0; k -= 1) {
        if (open[k]?.char === '[') {
          open.splice(k, 1)
          break
        }
      }
      // A destination has started. Until its `)` arrives the whole URL would
      // otherwise be on screen as text.
      if (text[index + 1] === '(') {
        const close = text.indexOf(')', index + 2)
        if (close === -1) {
          open.push({ char: '(', run: 1 })
          break
        }
        index = close + 1
        continue
      }
      index += 1
      continue
    }

    if (char === '*' || char === '_' || char === '~') {
      let run = 1
      while (text[index + run] === char) run += 1

      // `~` is strikethrough only as a pair; a lone one is an ordinary tilde.
      if (char === '~' && run !== 2) {
        index += run
        continue
      }

      const before = text[index - 1]
      const after = text[index + run]
      const innermost = open[open.length - 1]

      if (innermost?.char === char && canClose(char, before, after)) {
        open.pop()
      } else if (canOpen(char, before, after)) {
        open.push({ char, run })
      }

      index += run
      continue
    }

    index += 1
  }

  if (open.length === 0) return text

  let closed = text
  for (let k = open.length - 1; k >= 0; k -= 1) {
    const entry = open[k]
    if (entry === undefined || entry.char === '[') continue
    closed += entry.char === '(' ? ')' : entry.char.repeat(entry.run)
  }
  return closed
}

/** Where a backtick run of exactly `run` backticks next appears, or -1. */
function closingBacktickRun(text: string, from: number, run: number): number {
  let index = from
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    let length = 1
    while (text[index + length] === '`') length += 1
    if (length === run) return index
    index += length
  }
  return -1
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

function isWord(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/**
 * Left-flanking, in CommonMark's sense: there is something for the emphasis to
 * be applied to. `* 3` cannot open, which is what keeps arithmetic upright.
 */
function canOpen(char: string, before: string | undefined, after: string | undefined): boolean {
  if (isSpace(after)) return false
  // Underscore never opens inside a word, so `snake_case_name` stays a name.
  if (char === '_' && isWord(before)) return false
  return true
}

/** Right-flanking: a closer must follow content rather than a space. */
function canClose(char: string, before: string | undefined, after: string | undefined): boolean {
  if (isSpace(before)) return false
  if (char === '_' && isWord(after)) return false
  return true
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
    // first line rather than becoming one later. Anything that is not a fence
    // gets the same treatment for its inline markup. A closed fence that
    // happens to be last is left exactly as it is: its content is code, and
    // the delimiters in it are not markup to be balanced.
    tail: last.open
      ? closeOpenFence(last.text)
      : last.kind === 'fence'
        ? last.text
        : closeOpenInline(last.text),
  }
}
