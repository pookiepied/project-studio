import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'

import { COMPOSER, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The card a stopped run is answered through.
 *
 * ---- One shell, two callers -----------------------------------------------
 *
 * Both kinds of question stop the run and appear in the same place, between
 * the transcript and the composer. This is what they share: the framing, the
 * sentence line, the option rows, the control row, the footnotes beneath it,
 * and the keyboard behaviour. `ApprovalPrompt` renders through it, and the
 * ask-a-question card renders through it, so the person is never looking at
 * two different-looking things that do the same job.
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
 * ---- Enter -----------------------------------------------------------------
 *
 * Enter submits the card, wherever the focus sits on it - except on a button,
 * where Enter already means the button and a second submission would answer
 * twice. The callers decide what submitting means; the shell only decides
 * that one key does it.
 */
export function CardShell({
  header,
  sentence,
  detail = null,
  deadline = null,
  body = null,
  controls,
  footnotes = null,
  canSubmit,
  onSubmit,
  answering = false,
}: {
  /** The compact label chip: what kind of question this is. */
  readonly header: string
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
  /** The option rows, for the caller that has options to offer. */
  readonly body?: ReactNode | null
  /** The control row: the labelled ways out, one per outcome. */
  readonly controls: ReactNode
  /** Lines beneath the controls: consequences, and what else is waiting. */
  readonly footnotes?: ReactNode | null
  /** Whether submitting makes sense right now. */
  readonly canSubmit: boolean
  /** What submitting does. The caller owns the meaning; the shell owns the key. */
  readonly onSubmit: () => void
  /** An answer is in flight: submit is held and the controls disable themselves. */
  readonly answering?: boolean
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return
    // On a button, Enter is the button's own activation; answering again
    // here would record the same answer twice.
    if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') return
    if (!canSubmit || answering) return
    event.preventDefault()
    onSubmit()
  }

  return (
    <div
      onKeyDown={onKeyDown}
      // The composer's own multiline radius, so the card and the field it sits
      // above read as one family of objects resting on the same surface.
      style={{ borderRadius: COMPOSER.multilineRadius }}
      className="bg-surface-raised p-3 shadow-raised"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="max-w-[60ch] text-body font-medium">{sentence}</p>
        {deadline !== null ? <CardCountdown expiresAt={deadline} /> : null}
      </div>

      <p className="mt-1 max-w-[60ch] text-caption text-muted-foreground">{header}</p>

      {detail !== null ? (
        <p className="mt-1 max-w-[60ch] text-caption text-muted-foreground">{detail}</p>
      ) : null}

      {body !== null ? <div className="mt-2.5 flex flex-col gap-1">{body}</div> : null}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">{controls}</div>

      {footnotes !== null ? <div className="mt-1.5">{footnotes}</div> : null}
    </div>
  )
}

/**
 * One option row: the thing a question offers, and what it does.
 *
 * Single questions render these as a radio group; a multiSelect question
 * renders them with `role="checkbox"`. Either way the row carries the letter
 * the options are keyed by, the label, and the description that says what
 * happens if it is chosen - a choice made without its consequence is a guess
 * the person was tricked into.
 */
export function OptionRow({
  letter,
  label,
  description,
  selected,
  onSelect,
  multi = false,
  input = null,
  disabled = false,
}: {
  readonly letter: string
  readonly label: ReactNode
  readonly description: ReactNode
  readonly selected: boolean
  readonly onSelect: () => void
  /** Checkbox semantics when the question allows several answers. */
  readonly multi?: boolean
  /** A free-text field inside the row, for the always-present other answer. */
  readonly input?: ReactNode | null
  readonly disabled?: boolean
}) {
  return (
    <div
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
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
        'flex cursor-pointer items-start gap-2 rounded-lg p-2 text-left transition-colors duration-fast',
        selected ? 'bg-tint' : 'hover:bg-tint',
        disabled && 'pointer-events-none opacity-45',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-caption',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground',
        )}
        aria-hidden
      >
        {letter}
      </span>
      <span className="min-w-0">
        <span className="block text-ui">{label}</span>
        <span className="block text-caption text-muted-foreground">{description}</span>
        {input}
      </span>
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
      className="flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-caption tabular-nums"
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
