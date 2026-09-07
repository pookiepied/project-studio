import { useId, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, ENTER } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/**
 * The disclosure row of a reply: the quiet line a response element folds
 * into.
 *
 * The thinking trace, the tool-call summary and the components still to come
 * from the agent-UI component library are all one shape — a muted line
 * carrying a count or a duration, a mark that turns when it opens, and the
 * working-out hanging behind a rule beneath it. This is that shape, written
 * once. What a row says stays with its caller; this owns only the geometry
 * those rows were already sharing and had started to drift apart on.
 *
 * ---- The content boundary -------------------------------------------------
 *
 * A row's first painted element — its mark or, with no mark, its first word
 * — sits flush at the message's content boundary: the same left edge the
 * reply's prose starts at. Padding on the right only extends the press
 * target and moves nothing; padding on the left shifts the whole row off the
 * edge every other response element shares. Both rows that became this
 * component used to open with `pl-1` and sat four pixels right of the answer
 * above them, which read as an indent nobody had chosen — the thinking row
 * and the tool row moved left together, not separately, because the rule is
 * one rule.
 */
export function DisclosureRow({
  leading,
  label,
  open,
  onToggle,
  disabled = false,
  chevron = 'always',
  entering = false,
  flush = false,
  className,
  children,
}: {
  /** The mark before the words, if the row has one. */
  leading?: ReactNode
  /** The row's words. The caller owns them and any effect running over them. */
  label: ReactNode
  open: boolean
  onToggle: () => void
  /**
   * A row with nothing behind it is a statement, not a control: no tab stop,
   * no hover answer, no chevron promising an opening that is not there.
   */
  disabled?: boolean
  /**
   * `always` -- the disclosure is part of the row at rest, for a row whose
   * body is the content the reader came for. `hover` -- the disclosure
   * appears over the row and on keyboard focus and stays while open, for a
   * row whose job at rest is to be read past: a permanent chevron beside
   * every reply is a control advertising itself in a place the reader is
   * trying to read.
   */
  chevron?: 'always' | 'hover'
  /**
   * The row is arriving with a live turn rather than already sitting on the
   * page, so it enters on the house entrance -- the fade with a breath of
   * rise -- instead of popping into a transcript the reader is already
   * reading. Replayed rows set nothing: content that was already there does
   * not arrive twice.
   */
  entering?: boolean
  /**
   * The body stands without the rule and the indent, flush at the content
   * boundary. For a body that arrives as its own framed card -- the file
   * diff -- where a rule running down the left of the card draws a second
   * frame around work that already has one: two edges, a hand's width
   * apart, saying "inset" about something that is not inset. The default
   * stays ruled: loose working-out (a trace, a raw input) needs the edge to
   * be read as hanging off its row.
   */
  flush?: boolean
  /** Margins belong to the context a row sits in, not to the row. */
  className?: string
  /** What opens beneath the row, drawn behind the rule. */
  children?: ReactNode
}) {
  // The disclosure pattern's own wiring: the control says what it expands and
  // names the region it expands, so a screen reader announces the state and
  // can move to the body. A disabled row expands nothing and claims neither -
  // advertising a collapsed region that cannot be opened is worse than saying
  // nothing, because it invites a keystroke that does not work.
  const bodyId = useId()

  return (
    <motion.div
      className={className}
      initial={entering ? ENTER.initial : false}
      animate={ENTER.animate}
      transition={ENTER.transition}
    >
      <button
        type="button"
        onClick={onToggle}
        {...(disabled ? {} : { 'aria-expanded': open, 'aria-controls': bodyId })}
        disabled={disabled}
        className={cn(
          // `max-w-full` is load-bearing, not tidiness. An inline-flex box
          // sizes to its content and nothing above it caps the width, so a
          // long subject - a shell command with half a dozen npm flags - grew
          // the button straight past the reading column and out of the
          // window. The `truncate` on the subject could never fire: there was
          // no bounded width for it to shrink against.
          'group/disclosure inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left',
          'text-caption text-muted-foreground transition-colors duration-fast',
          disabled ? 'cursor-default' : 'hover:text-foreground',
        )}
      >
        {leading}
        {label}
        {disabled ? null : (
          <Icons.disclosure
            state={open ? 'on' : 'rest'}
            className={
              chevron === 'hover'
                ? cn(
                    'transition-opacity duration-fast',
                    open
                      ? 'opacity-100'
                      : 'opacity-0 group-hover/disclosure:opacity-100 group-focus-visible/disclosure:opacity-100',
                  )
                : undefined
            }
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...COLLAPSE} id={bodyId} className="overflow-hidden">
            {/* Indented behind a rule rather than boxed: a bordered card would
                give the working-out the same visual weight as the answer it
                sits under. One step of air between the row and the rule, the
                same for every row -- the callers this replaced disagreed by
                two pixels here for no reason either of them could state. A
                `flush` body keeps the air and drops the edge; see the prop. */}
            <div className={cn('mt-1.5', !flush && 'ml-1.5 border-l-2 pl-3')}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
