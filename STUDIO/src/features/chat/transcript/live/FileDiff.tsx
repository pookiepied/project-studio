import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { cn } from '@/lib/cn'

import type { DiffRow, LineDiff } from './diffLines'

/**
 * The working-out of a file-writing call, expanded: the lines the call added
 * and removed, on the aicss file-diff's grammar -- a head naming the file
 * beside the change count, then rows tinted by direction, each carrying a
 * sign and an accent bar. Rebuilt on the studio's tokens rather than copied:
 * the well is `--code-surface` (the panel colour, the one that darkens in
 * dark mode), the notation colours are the diff tokens, the grounds mix from
 * them per mode, and nothing here carries a fixed colour a palette change
 * would have to fight. The proportions -- twelve-and-a-half-ish type on
 * twenty-pixel rows, a hairline edge with a chip's shadow, a bar three
 * pixels wide -- are the original's, because those proportions are most of
 * what makes it read as a diff rather than as coloured text.
 *
 * ---- Line numbers are printed only when they are true ---------------------
 *
 * `numbered` is a property of the diff, not a preference of this card. A
 * whole-file write is the file, so its rows know their positions. An edit
 * knows where its span sits only when the harness's own answer echoes it,
 * and `editOutcome`'s anchoring accepts those numbers only where the echo
 * corroborates every row -- an uncorroborated edit keeps its gutters empty.
 * Numbers that pointed at the wrong lines would be a navigational lie told
 * in a monospace font -- the one thing a diff must never be.
 */
export function FileDiff({ path, diff }: { path: string; diff: LineDiff }) {
  const numbered = diff.rows.some((row) => row.oldLine !== null || row.newLine !== null)
  const { name, dir } = splitFilePath(path)
  return (
    // `text-foreground` is load-bearing, not decoration: nothing in this app
    // sets a default text colour, so an uncoloured surface inherits the
    // browser's black -- which in dark mode is a card full of invisible
    // lines. The transcript's prose sets its colour the same way.
    <div className="overflow-hidden rounded-md border border-hairline bg-code-surface text-foreground shadow-chip">
      <div className="flex items-center gap-2 border-b border-hairline py-2 pl-3 pr-3">
        <FileTypeMark path={path} className="text-muted-foreground" />
        <span className="truncate font-mono text-ui" title={path}>
          {dir !== null ? <span className="text-muted-foreground">{dir}/</span> : null}
          {name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-ui">
          <span className="text-diff-add">+{diff.added}</span>{' '}
          <span className="text-diff-del">-{diff.removed}</span>
        </span>
      </div>
      {diff.rows.length > 0 ? (
        // The cap is the whole-file guard: a write of a thousand lines is
        // still one card in a reading column, and it scrolls inside itself
        // rather than pushing the conversation a screenful down. 288px is
        // roughly a dozen rows plus a head -- enough to see what kind of
        // change this is before deciding to scroll it.
        //
        // The body is code, and carries the code-text setting like every
        // other code surface: text-ui pinned it to the interface size, and
        // the appearance row could move every code block but this one. The
        // role brings its own relative leading, so the fixed one goes.
        <div className="studio-scroll-frame max-h-72 overflow-auto py-1 font-mono text-code">
          {/* The gutter divider runs on the inner track, so it scrolls with
              the rows and stays at the gutters' edge however wide the code
              runs -- the same placement the aicss original gives it. */}
          <div
            className={cn(
              'relative w-max min-w-full',
              numbered &&
                "after:absolute after:inset-y-0 after:left-20 after:w-px after:bg-hairline after:content-['']",
            )}
          >
            {diff.rows.map((row, index) => (
              <DiffRowView key={index} row={row} numbered={numbered} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DiffRowView({ row, numbered }: { row: DiffRow; numbered: boolean }) {
  const changed = row.type !== 'ctx'
  return (
    <div
      className={cn(
        'relative grid items-baseline pr-3',
        numbered ? 'grid-cols-[2.5rem_2.5rem_1.25rem_1fr]' : 'grid-cols-[1.25rem_1fr]',
        // The tint answers "what kind of row"; the bar is the same answer at
        // the row's edge, for the scan down the gutter. The deletion bar
        // hatches -- a solid bar says "this row is red", the cut says "this
        // row is gone" -- while the addition bar stays solid, which is what
        // the aicss original does and what the two directions need to stay
        // distinguishable at the edge of the eye.
        row.type === 'add' && 'bg-diff-add-ground before:bg-diff-add',
        row.type === 'del' && 'studio-diff-del-bar bg-diff-del-ground',
        changed && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
      )}
    >
      {numbered ? <Gutter value={row.oldLine} tone={row.type === 'del' ? 'del' : null} /> : null}
      {numbered ? <Gutter value={row.newLine} tone={row.type === 'add' ? 'add' : null} /> : null}
      <span
        aria-hidden
        className={cn(
          'select-none text-center',
          row.type === 'add' && 'text-diff-add',
          row.type === 'del' && 'text-diff-del',
        )}
      >
        {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ''}
      </span>
      <code className={cn('studio-selectable whitespace-pre pl-2', !changed && 'text-muted-foreground')}>
        {/* A wholly empty line collapses without a character to carry the
            row's height, so it draws a space instead. */}
        {row.text === '' ? ' ' : row.text}
      </code>
    </div>
  )
}

function Gutter({ value, tone }: { value: number | null; tone: 'add' | 'del' | null }) {
  return (
    <span
      className={cn(
        'select-none pr-2 text-right text-caption tabular-nums',
        // A number on a changed row takes its row's direction, as its sign
        // does: the gutter is part of the row's answer, not furniture.
        tone === 'add' && 'text-diff-add',
        tone === 'del' && 'text-diff-del',
        tone === null && 'text-muted-foreground',
      )}
    >
      {value ?? ''}
    </span>
  )
}
