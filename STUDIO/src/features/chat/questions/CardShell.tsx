import { AnimatePresence, motion } from 'framer-motion'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/**
 * The card a stopped run is answered through.
 *
 * ---- One shell, two callers -----------------------------------------------
 *
 * Both kinds of question stop the run and take the composer's place until
 * they are answered. This is what they share: the hint row, the sentence, the
 * answer rows, the description slot, the foot, and the keyboard behaviour.
 * `ApprovalPrompt` renders through it and the ask-a-question card renders
 * through it, inside one `PromptFrame`, so the person is never looking at two
 * different-looking things that do the same job.
 *
 * ---- The shape -------------------------------------------------------------
 *
 * Family A's suggestion panel. A quiet hint row: the keys on the left; on the
 * right what kind of question this is, where it stands in its call ("2 of 3"),
 * and Skip. Then the sentence, then the answers one line each, an accent arrow
 * and the words, with a neutral highlight the width of the answer column. What the lit row does
 * is said once, in a slot of a fixed two lines, so pointing along the rows
 * never changes the card's height. The foot is the caller's: an answer field
 * for a question, the stop for a permission.
 *
 * ---- What the shell does not know ------------------------------------------
 *
 * Everything. It holds no policy: no timeout, no default, no opinion about
 * what an unanswered question means. A deadline reaches it only as a number a
 * caller chose to pass, and the permission caller passes null - always, by
 * construction of its own props, which carry no deadline to pass. The shell
 * draws a countdown when it is given one and draws nothing when it is not; it
 * never resolves anything on its own, and no prop of this component could
 * hand a permission the one thing a permission must never have.
 *
 * The suggestion panel this borrows from closes on Escape. This card does not,
 * and its hint row does not offer it: an Escape that dismissed a permission
 * would be pressed meaning "not now" and read as "no".
 *
 * ---- Keys ------------------------------------------------------------------
 *
 * Up and down move the highlight and focus the row it lands on, so the next
 * Enter answers with that row. Enter on a row is the row's own activation.
 * Enter anywhere else on the card submits it - except on a button, where Enter
 * already means the button and a second submission would answer twice. The
 * callers decide what submitting means; the shell only decides that one key
 * does it.
 */

interface CardRows {
  readonly active: number | null
  readonly setActive: (index: number | null) => void
}

const CardRowsContext = createContext<CardRows>({ active: null, setActive: () => {} })

export function CardShell({
  header,
  progress = null,
  onSkip = null,
  sentence,
  detail = null,
  deadline = null,
  body = null,
  bodyLabel,
  descriptions = [],
  initialActive = null,
  aside = null,
  foot = null,
  canSubmit,
  onSubmit,
  answering = false,
}: {
  /** The hint row's name for what kind of question this is. */
  readonly header: string
  /** Where this question stands in its call, when the call asks more than one. */
  readonly progress?: { readonly at: number; readonly of: number } | null
  /** Leaves this question to the agent, or null where skipping means nothing. */
  readonly onSkip?: (() => void) | null
  /** The main line: the question being asked of the person. */
  readonly sentence: ReactNode
  /** A secondary line under the sentence: a reason, or nothing. */
  readonly detail?: ReactNode | null
  /**
   * The epoch millisecond this question expires at, or null. Null is the
   * honest render for a question that will wait forever, and it is what the
   * permission caller always passes.
   */
  readonly deadline?: number | null
  /** The answer rows, `OptionRow`s indexed from zero in the order drawn. */
  readonly body?: ReactNode | null
  /** What the rows are, for assistive technology. */
  readonly bodyLabel?: string
  /**
   * What each row does, by row index. The lit row's line shows in a slot of a
   * fixed two lines beneath the rows, so the card keeps its height whichever
   * row is lit, and the list stays one line per answer.
   */
  readonly descriptions?: readonly (ReactNode | null)[]
  /** The row highlighted on arrival, or null for none. */
  readonly initialActive?: number | null
  /** A control at the end of the description line, so it costs no row of its own. */
  readonly aside?: ReactNode | null
  /** The card's last row: the answer field, or what else waits. */
  readonly foot?: ReactNode | null
  /** Whether submitting makes sense right now. */
  readonly canSubmit: boolean
  /** What submitting does. The caller owns the meaning; the shell owns the key. */
  readonly onSubmit: () => void
  /** An answer is in flight: submit is held and the controls disable themselves. */
  readonly answering?: boolean
}) {
  const card = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(initialActive)

  const move = (step: 1 | -1) => {
    const rows = Array.from(
      card.current?.querySelectorAll<HTMLElement>('[data-card-row]:not([aria-disabled="true"])') ?? [],
    )
    if (rows.length === 0) return
    const at = rows.findIndex((row) => Number(row.dataset.cardRow) === active)
    const next = at === -1 ? (step === 1 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length
    const row = rows[next]
    setActive(Number(row.dataset.cardRow))
    row.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A written answer is prose: its arrows move the caret between lines.
    const writing = event.target instanceof HTMLTextAreaElement
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !writing) {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key !== 'Enter' || writing) return
    // On a button, Enter is the button's own activation; answering again
    // here would record the same answer twice.
    if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') return
    if (!canSubmit || answering) return
    event.preventDefault()
    onSubmit()
  }

  const described = descriptions.some((line) => line !== null && line !== undefined)

  return (
    // `text-foreground` is load-bearing, not decoration: nothing in this app
    // sets a default text colour, so an uncoloured surface inherits the
    // browser's black, which in dark mode is a card of invisible sentences.
    <div ref={card} data-prompt-card onKeyDown={onKeyDown} className="text-foreground">
      <div className="flex min-h-5 items-center gap-3 px-2 text-micro text-muted-foreground">
        {body !== null ? <KeyHints /> : null}
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <span className="truncate">{header}</span>
          {progress !== null && progress.of > 1 ? (
            <span className="shrink-0 tabular-nums" aria-label={`Question ${progress.at} of ${progress.of}`}>
              {progress.at} of {progress.of}
            </span>
          ) : null}
          {onSkip !== null ? (
            // A tag rather than a word, so it reads as the control it is in a
            // row that is otherwise all hints.
            <button
              type="button"
              onClick={onSkip}
              disabled={answering}
              className="studio-prompt-tag shrink-0 transition-colors duration-fast disabled:opacity-45"
            >
              Skip
            </button>
          ) : null}
          {deadline !== null ? <CardCountdown expiresAt={deadline} /> : null}
        </span>
      </div>

      <p className="mt-2 max-w-[60ch] px-2 text-body font-medium">{sentence}</p>

      {detail !== null ? (
        <p className="mt-0.5 max-w-[60ch] px-2 text-caption text-muted-foreground">{detail}</p>
      ) : null}

      {body !== null ? (
        <CardRowsContext.Provider value={{ active, setActive }}>
          {/* One column as wide as the longest answer: every highlight is the
              same width, so the rows read as one block - neither the whole
              card nor a ragged edge per word. */}
          <div role="group" aria-label={bodyLabel} className="mt-1.5 flex w-fit max-w-full min-w-48 flex-col items-stretch gap-0.5">
            {body}
          </div>
        </CardRowsContext.Provider>
      ) : null}

      {/* Two lines whether the lit row says one, two or nothing, so pointing
          along the rows never moves the card. Longer lines clamp. */}
      {body !== null && (described || aside !== null) ? (
        <div className="mt-1 flex items-end gap-3 pl-2">
          <p aria-live="polite" className="line-clamp-2 min-h-[2lh] max-w-[60ch] min-w-0 flex-1 text-caption text-muted-foreground">
            {active === null ? null : (descriptions[active] ?? null)}
          </p>
          {aside}
        </div>
      ) : null}

      {foot !== null ? <div className="mt-2">{foot}</div> : null}
    </div>
  )
}

/**
 * The keys that answer the card, said the way the suggestion panel says them.
 * Shared with the slash list, which adds Escape: a list a slash opened is
 * dismissed by Escape, where this card deliberately is not.
 */
export function KeyHints({ dismiss = false }: { readonly dismiss?: boolean }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-4 text-micro text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="flex gap-0.5">
          <Key>▲</Key>
          <Key>▼</Key>
        </span>
        to navigate
      </span>
      <span className="flex items-center gap-1.5">
        <Key>↩</Key>
        to select
      </span>
      {dismiss ? (
        <span className="flex items-center gap-1.5">
          <Key>esc</Key>
          to dismiss
        </span>
      ) : null}
    </span>
  )
}

function Key({ children }: { readonly children: ReactNode }) {
  return <kbd className="studio-prompt-key">{children}</kbd>
}

/**
 * One answer row: an arrow and the answer, on one line.
 *
 * Three kinds. A `radio` row is one choice of a single-answer question, a
 * `checkbox` row one of several, and an `action` row answers on its own click,
 * as a permission's rows do. What a row does is said by the card's description
 * slot while the row is lit - a choice made without its consequence is a guess
 * the person was tricked into, so hover and the arrow keys both light it.
 *
 * The lit row wears a neutral wash across the card's answer column (as wide as
 * the longest answer, so every row's wash is the same width); so does a chosen one, so the choice stays visible through
 * the beat before the card moves on. A checkbox row trades the arrow for a
 * ring that fills when ticked.
 */
export function OptionRow({
  index,
  label,
  selected = false,
  onSelect,
  kind = 'radio',
  disabled = false,
  busy = false,
}: {
  /** The row's place among the card's rows, from zero. */
  readonly index: number
  readonly label: ReactNode
  readonly selected?: boolean
  readonly onSelect: () => void
  readonly kind?: 'radio' | 'checkbox' | 'action'
  readonly disabled?: boolean
  /** This row's answer is the one in flight. */
  readonly busy?: boolean
}) {
  const { active, setActive } = useContext(CardRowsContext)
  const lit = active === index || (selected && kind !== 'checkbox')

  return (
    <div
      data-card-row={index}
      role={kind === 'action' ? 'button' : kind}
      aria-checked={kind === 'action' ? undefined : selected}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      tabIndex={disabled ? -1 : 0}
      onMouseEnter={() => setActive(index)}
      onFocus={() => setActive(index)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // The row's own activation: Enter or Space selects. Stopped here and
        // not allowed to bubble, or one press on the card would select the
        // row and submit the question underneath it.
        if (event.target instanceof HTMLElement && event.target.closest('input')) return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
      onClick={onSelect}
      className={cn(
        'flex max-w-full cursor-pointer items-center gap-3 rounded-[12px] py-1.5 pr-3 pl-2 text-left text-body outline-none transition-colors duration-fast',
        lit && 'bg-soft',
        disabled && !busy && 'pointer-events-none opacity-45',
        busy && 'pointer-events-none',
      )}
    >
      <span aria-hidden className="flex shrink-0 items-center">
        {kind === 'checkbox' ? (
          <span
            className={cn(
              'flex size-[15px] items-center justify-center rounded-full transition-colors duration-fast',
              selected ? 'bg-accent text-accent-foreground' : 'ring-1 ring-muted-foreground/40 ring-inset',
            )}
          >
            {/* Well inside the ring: a tick that reaches the edge reads as
                cramped. Sized by `style`, because the mark's own box is an
                inline width that a size class cannot override - which is why
                the tick used to paint at 16.5px inside a 15px ring. */}
            {selected ? <Icons.check className="text-accent-foreground" style={{ width: 9, height: 9 }} /> : null}
          </span>
        ) : (
          <Icons.choose className={cn('text-accent', busy && 'animate-pulse')} />
        )}
      </span>
      <span className="min-w-0">{label}</span>
    </div>
  )
}

/**
 * The countdown, when the question actually has a deadline.
 *
 * Digits roll rather than swap, in the direction the number is moving, so a
 * glance reads "how long" without parsing new characters. Nothing here
 * resolves anything at zero: the harness owns the deadline, the next poll
 * settles it, and this element is a clock, not a policy.
 */
function CardCountdown({ expiresAt }: { readonly expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const remaining = Math.max(0, expiresAt - now)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1_000)
  const label = `${minutes}:${String(seconds).padStart(2, '0')}`

  return (
    <span
      data-countdown
      aria-live="polite"
      aria-label={`${minutes} minutes ${seconds} seconds remaining`}
      className="flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-caption tabular-nums"
    >
      {label.split('').map((character, at) =>
        character === ':' ? (
          <span key={at} className="px-px text-muted-foreground">
            :
          </span>
        ) : (
          <RollingChar key={at} value={character} />
        ),
      )}
    </span>
  )
}

/**
 * One rolling digit slot.
 *
 * A countdown only ever shrinks, so a changed digit rolls downward: the new
 * value enters from above and the old leaves below. Keying by value rather
 * than by position is what makes untouched digits hold still.
 */
function RollingChar({ value }: { readonly value: string }) {
  return (
    <span className="relative inline-flex overflow-hidden" style={{ height: '1.05em' }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
