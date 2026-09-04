import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/primitives'
import { CardShell, OptionRow } from '@/features/chat/questions/CardShell'
import type { PendingQuestionRecord } from '@/platform/harness'

/**
 * The question a run stops and asks, rendered through the one card shell.
 *
 * One question at a time, oldest first - the order the harness raised them -
 * with the others named beneath. The free-text row is always present and is
 * never something the model asked for: it is a property of this card, so no
 * schema and no question can take away the answer the model did not think of.
 *
 * ---- The ways out, and why there are three ---------------------------------
 *
 * Choosing an option answers the question. "You decide" defers it: the person
 * is present and declining to choose, and the run continues told exactly
 * that. "Stop" ends the run. They are separate labelled controls because an
 * ambiguous dismissal - an X, a click outside, an escape - would be pressed
 * meaning one thing and do the other, and the two are not equally
 * recoverable: a halted run costs ten seconds; a run that continued on a
 * guess has already written files. There is no click-outside-to-close and no
 * escape-to-close here on purpose.
 *
 * ---- The beat --------------------------------------------------------------
 *
 * A single-select answer advances after a short pause rather than instantly,
 * so the choice is visibly made before the next question slides in. This is
 * borrowed interaction, not borrowed paint - the card's look is Studio's.
 */

/** How long a choice stays visible before the card advances. */
const ADVANCE_MS = 320

export function QuestionPrompt({
  rows,
  answeringId,
  onAnswer,
  onStop,
}: {
  /** This conversation's pending questions, oldest first; non-empty by contract. */
  readonly rows: readonly PendingQuestionRecord[]
  /** The question an answer is currently in flight for, if any. */
  readonly answeringId: string | null
  readonly onAnswer: (
    id: string,
    answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
  ) => Promise<void>
  /** Stops every question this conversation is asking, and the run with it. */
  readonly onStop: () => void
}) {
  const question = rows[0]
  const waiting = rows.slice(1)
  const letterFor = (at: number): string => String.fromCharCode(65 + at)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([])
  const [text, setText] = useState('')
  const [advancing, setAdvancing] = useState(false)
  const advancingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    return () => {
      if (advancingTimer.current !== null) clearTimeout(advancingTimer.current)
    }
  }, [])

  const otherId = 'something-else'
  const answering = answeringId === question.id

  const commit = (answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean }) => {
    void onAnswer(question.id, answer)
  }

  /** The answer Enter would give, or null when there is nothing to send. */
  const pendingAnswer = (): { optionIds?: readonly string[]; text?: string } | null => {
    const written = text.trim()
    if (written !== '' && selectedId === otherId) return { text: written }
    if (question.payload.multiSelect) {
      return checkedIds.length > 0 ? { optionIds: checkedIds } : null
    }
    return selectedId !== null && selectedId !== otherId ? { optionIds: [selectedId] } : null
  }

  const choose = (optionId: string) => {
    if (advancing || answering) return
    if (optionId === otherId) {
      setSelectedId(otherId)
      inputRef.current?.focus()
      return
    }
    if (question.payload.multiSelect) {
      setCheckedIds((current) =>
        current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      )
      return
    }
    setSelectedId(optionId)
    // A beat, so the choice is seen before the card moves on.
    setAdvancing(true)
    advancingTimer.current = setTimeout(() => {
      setAdvancing(false)
      commit({ optionIds: [optionId] })
    }, ADVANCE_MS)
  }

  const submit = () => {
    if (advancing || answering) return
    const answer = pendingAnswer()
    if (answer !== null) commit(answer)
  }

  const defer = () => {
    if (answering) return
    commit({ deferred: true })
  }

  // The continue control exists only when a click would otherwise have
  // nothing to commit: a multiSelect question, or a written answer. A
  // single-select question commits on its own click.
  const needsContinue =
    (question.payload.multiSelect && checkedIds.length > 0) ||
    (selectedId === otherId && text.trim() !== '')

  return (
    <CardShell
      header={question.payload.header}
      sentence={question.payload.question}
      detail={question.payload.multiSelect ? 'Choose all that apply.' : null}
      // The countdown is the row's own deadline. A question that will wait
      // forever gets no timer, because a timer on it would be a lie.
      deadline={question.expiresAt}
      body={
        <>
          {question.payload.options.map((option, at) => (
            <OptionRow
              key={option.id}
              letter={letterFor(at)}
              label={option.label}
              description={option.description}
              selected={
                question.payload.multiSelect
                  ? checkedIds.includes(option.id)
                  : selectedId === option.id
              }
              onSelect={() => choose(option.id)}
              multi={question.payload.multiSelect}
              disabled={advancing || answering}
            />
          ))}
          <OptionRow
            letter={letterFor(question.payload.options.length)}
            label="Something else"
            description="Answer in your own words."
            selected={selectedId === otherId}
            onSelect={() => choose(otherId)}
            disabled={advancing || answering}
            input={
              <input
                ref={inputRef}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  // Typing is itself the choice: the written answer is the
                  // one being composed, whatever else was selected.
                  setSelectedId(otherId)
                }}
                placeholder="Something else..."
                aria-label="Your own answer"
                className="mt-1 w-full rounded-md border bg-surface px-2 py-1 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          />
        </>
      }
      controls={
        <>
          <div className="flex items-center gap-2">
            {/* Two labelled controls, never one ambiguous dismissal. */}
            <Button variant="ghost" size="sm" disabled={answering} onClick={defer}>
              You decide
            </Button>
            <Button variant="danger" size="sm" disabled={answering} onClick={onStop}>
              Stop
            </Button>
          </div>
          {needsContinue ? (
            <Button variant="primary" size="sm" busy={answering} onClick={submit}>
              {rows.length > 1 ? 'Continue' : 'Submit'}
            </Button>
          ) : null}
        </>
      }
      canSubmit={pendingAnswer() !== null}
      onSubmit={submit}
      answering={answering}
      footnotes={
        waiting.length > 0 ? (
          <p className="max-w-[60ch] text-caption text-muted-foreground">
            Also waiting, one at a time:{' '}
            {waiting.map((row, at) => (
              <span key={row.id}>
                {at > 0 ? ', ' : ''}
                {row.payload.header}
              </span>
            ))}
          </p>
        ) : null
      }
    />
  )
}
