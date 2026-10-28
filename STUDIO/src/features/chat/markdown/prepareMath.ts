/**
 * Decide which dollar signs are maths before remark-math does.
 *
 * remark-math pairs any two `$` in a paragraph, so a sentence about money --
 * "fell from about $100 in January to about $74" -- became one italic formula
 * reading "100inJanuarytoabout74". Pandoc settled this long ago with two rules,
 * applied here: an opening `$` must touch the character after it, and a
 * closing `$` must touch the character before it and must not be followed by a
 * digit. A `$` that opens no valid span is escaped and stays a dollar.
 *
 * Two further repairs, both for things models write every day:
 *
 * - Inside a formula, `\$` is TeX's dollar. remark-math does not honour the
 *   escape when it looks for the closer, so `$x = \$100$` closed at the
 *   backslash and KaTeX drew an error. It is rewritten to `\char36`, the same
 *   glyph by code point, which carries no delimiter to misread.
 * - `$$ ... $$` on one line is display maths by intent, but remark-math only
 *   treats `$$` as a block when the fences sit on their own lines; otherwise it
 *   is inline and the equation renders small, flush left, mid-paragraph. A
 *   line that is nothing but one such formula is opened into a block.
 *
 * Code is left untouched: fenced blocks and backtick spans pass through as
 * written, since a dollar in a shell snippet is not a price or a formula.
 */

// Any indentation: a fence nested in a list item sits deeper than three spaces.
const FENCE = /^\s*(`{3,}|~{3,})/
const DISPLAY_LINE = /^(\s*)\$\$(?!\$)(.+?)\$\$\s*$/

export function prepareMath(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let paragraph: string[] = []
  let display = false

  const flush = () => {
    if (paragraph.length > 0) out.push(...inlineMath(paragraph.join('\n')).split('\n'))
    paragraph = []
  }

  for (const line of lines) {
    const open = FENCE.exec(line)?.[1]
    if (fence !== null) {
      out.push(line)
      if (open !== undefined && open[0] === fence[0] && open.length >= fence.length && line.trim() === open) fence = null
      continue
    }
    if (open !== undefined) {
      flush()
      fence = open
      out.push(line)
      continue
    }
    // A display block that is already fenced on its own lines is remark-math's
    // own syntax; its body is TeX and is left exactly as written.
    if (line.trim() === '$$') {
      flush()
      display = !display
      out.push(line)
      continue
    }
    if (display) {
      out.push(line)
      continue
    }
    const single = DISPLAY_LINE.exec(line)
    if (single !== null) {
      flush()
      out.push(`${single[1]}$$`, `${single[1]}${single[2]?.trim()}`, `${single[1]}$$`)
      continue
    }
    if (line.trim() === '') {
      flush()
      out.push(line)
      continue
    }
    paragraph.push(line)
  }
  flush()
  return out.join('\n')
}

/** Resolve the dollars of one paragraph, skipping inline code spans. */
function inlineMath(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '`') {
      const run = /^`+/.exec(text.slice(index))?.[0] ?? '`'
      const close = text.indexOf(run, index + run.length)
      if (close !== -1) {
        out += text.slice(index, close + run.length)
        index = close + run.length
        continue
      }
      out += run
      index += run.length
      continue
    }
    if (char === '\\') {
      out += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (char !== '$') {
      out += char
      index += 1
      continue
    }
    const double = text[index + 1] === '$'
    const width = double ? 2 : 1
    const close = closer(text, index + width, width)
    if (close === -1) {
      out += double ? '\\$\\$' : '\\$'
      index += width
      continue
    }
    const body = text.slice(index + width, close).replace(/\\\$/g, '\\char36 ')
    out += '$'.repeat(width) + body + '$'.repeat(width)
    index = close + width
  }
  return out
}

/** Where the span opened at `from` closes, by the pandoc rules; -1 for none. */
function closer(text: string, from: number, width: number): number {
  const first = text[from]
  if (first === undefined || /\s/.test(first)) return -1
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char !== '$') continue
    if (width === 2 && text[index + 1] !== '$') continue
    if (width === 1 && text[index + 1] === '$') return -1
    const before = text[index - 1] ?? ''
    const after = text[index + width] ?? ''
    if (index > from && !/\s/.test(before) && !/\d/.test(after)) return index
    // An invalid closer is still a dollar this opener cannot reach past: the
    // run of text after it belongs to whatever that dollar starts.
    return -1
  }
  return -1
}
