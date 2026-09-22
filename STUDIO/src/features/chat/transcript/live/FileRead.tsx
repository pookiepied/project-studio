import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'

/**
 * The working-out of a read, expanded: the page the call returned, on the
 * same card grammar the file-diff uses -- a head naming the file, then the
 * content, each row carrying the line number the read itself reported.
 *
 * ---- The lines are the file's, because the harness says so ----------------
 *
 * The read tool answers with `cat -n` lines -- right-padded numbers, a tab,
 * the text -- and the numbers in that shape are true file line numbers, the
 * same ones an edit's echo carries. This card prints them into a gutter for
 * the same reason the diff card does: they are how a person checks that what
 * the model read is the file the person knows, and a number here points at
 * the same line it points at in an editor. The parse is by shape, not by
 * faith: every line must carry the harness's `cat -n` form (or the trailing
 * window footer) or the card is refused and the call falls back to the raw
 * answer -- prose that merely resembles a page must never be drawn as one.
 */
export interface ReadPage {
  readonly rows: readonly { readonly line: number; readonly text: string }[]
  /** The window the footer reported, when the read said the file goes on. */
  readonly window: { readonly from: number; readonly to: number; readonly total: number } | null
}

const NUMBERED_LINE = /^ *(\d+)\t(.*)$/
const WINDOW_FOOTER = /^\[showing lines (\d+)-(\d+) of (\d+);/

/**
 * The numbered page a read's answer holds, or null.
 *
 * The footer line is lifted out before the rows are read, so a body line
 * that happens to open with a bracket is not asked to be the footer. A text
 * with no numbered lines at all -- a refusal, a sentence -- is not a page:
 * null sends the call back to the raw rendering every other tool shares.
 */
export function readPage(text: string): ReadPage | null {
  const lines = text.split('\n')
  const footer = WINDOW_FOOTER.exec(lines.at(-1) ?? '')
  const body = footer === null ? lines : lines.slice(0, -1)
  const rows: { line: number; text: string }[] = []
  for (const line of body) {
    const match = NUMBERED_LINE.exec(line)
    if (match === null || match[1] === undefined || match[2] === undefined) return null
    rows.push({ line: Number(match[1]), text: match[2] })
  }
  if (rows.length === 0) return null
  return {
    rows,
    ...(footer === null || footer[1] === undefined || footer[2] === undefined || footer[3] === undefined
      ? { window: null }
      : {
          window: { from: Number(footer[1]), to: Number(footer[2]), total: Number(footer[3]) },
        }),
  }
}

export function FileRead({ path, page }: { path: string; page: ReadPage }) {
  const { name, dir } = splitFilePath(path)
  const first = page.rows[0]?.line ?? null
  const last = page.rows.at(-1)?.line ?? null
  return (
    // The card grammar is the file-diff's -- same well, same edge, same head
    // -- so a read page and a diff read as two views of one kind of fact:
    // the file, at rest. What differs is the body, which is why this is not
    // FileDiff parameterised: no signs, no tinting, one gutter of numbers
    // that are true because the read itself numbered them.
    <div className="overflow-hidden rounded-md border border-hairline bg-code-surface text-foreground shadow-chip">
      <div className="flex items-center gap-2 border-b border-hairline py-2 pl-3 pr-3">
        <FileTypeMark path={path} className="text-muted-foreground" />
        <span className="truncate font-mono text-ui" title={path}>
          {dir !== null ? <span className="text-muted-foreground">{dir}/</span> : null}
          {name}
        </span>
        {first !== null && last !== null ? (
          <span className="ml-auto shrink-0 font-mono text-ui text-muted-foreground">
            {page.window === null
              ? `lines ${first}-${last}`
              : `lines ${page.window.from}-${page.window.to} of ${page.window.total}`}
          </span>
        ) : null}
      </div>
      <div className="studio-scroll-frame max-h-72 overflow-auto py-1 font-mono text-code">
        <div
          className="relative w-max min-w-full after:absolute after:inset-y-0 after:left-10 after:w-px after:bg-hairline after:content-['']"
        >
          {page.rows.map((row, index) => (
            <ReadRowView key={index} line={row.line} text={row.text} />
          ))}
        </div>
      </div>
      {page.window !== null ? (
        <div className="border-t border-hairline px-3 py-1.5 text-caption text-muted-foreground">
          {`Showing lines ${page.window.from}-${page.window.to} of ${page.window.total}.`}
        </div>
      ) : null}
    </div>
  )
}

function ReadRowView({ line, text }: { line: number; text: string }) {
  return (
    <div className="relative grid items-baseline pr-3 grid-cols-[2.5rem_1fr]">
      <span className="select-none pr-2 text-right text-caption tabular-nums text-muted-foreground">
        {line}
      </span>
      <code className="studio-selectable whitespace-pre pl-2">{text === '' ? ' ' : text}</code>
    </div>
  )
}
