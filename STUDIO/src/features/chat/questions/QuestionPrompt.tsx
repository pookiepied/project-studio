import { useEffect, useRef, useState } from 'react'

import { CardShell, OptionRow } from '@/features/chat/questions/CardShell'
import { AnswerField } from '@/features/chat/questions/PromptFoot'
import { PromptFrame } from '@/features/chat/questions/PromptFrame'
import type { PendingQuestionRecord } from '@/platform/harness'

/**
 * The question a run stops and asks, standing where the composer was.
 *
 * One question at a time, oldest first - the order the harness raised them -
 * with "2 of 3" in the hint row while a call asks several. The harness hands
 * the model its answers only once every question of the call is settled, so
 * the count is how a person knows the run is still waiting on them.
 *
 * ---- The ways out ----------------------------------------------------------
 *
 * Choosing an answer, or writing one, answers the question. Skip leaves it to
 * the agent: the harness tells the model plainly that the person skipped and
 * that it should choose and say what it chose. The round button stops the run,
 * exactly as the composer's does. Nothing else: no click outside, no Escape,
 * because an ambiguous dismissal would be pressed meaning one thing and do
 * another, and a run that carried on a guess has already written files.
 *
 * ---- The beat --------------------------------------------------------------
 *
 * A single-answer choice advances after a short pause rather than instantly,
 * so the choice is visibly made before the next question slides in.
 */

/** How long a choice stays visible before the card advances. */
const ADVANCE_MS = 320

type Answer = { optionIds?: readonly string[]; text?: string; deferred?: boolean }

export function QuestionPrompt({
  rows,
  answeringId,
  onAnswer,
  onStop = null,
  fromHeight = null,
}: {
  /** This conversation's pending questions, oldest first; non-empty by contract. */
  readonly rows: readonly PendingQuestionRecord[]
  /** The question an answer is currently in flight for, if any. */
  readonly answeringId: string | null
  readonly onAnswer: (id: string, answer: Answer) => Promise<void>
  /** Ends the run, as the composer's stop does. */
  readonly onStop?: (() => void) | null
  /** The composer's height as it gave way, so the card opens from it. */
  readonly fromHeight?: number | null
}) {
  const question = rows[0]

  // Every question seen while the card has stood, so the count holds as they
  // are answered: the pending list only ever says what is left.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(rows.map((row) => row.id)))
  useEffect(() => {
    if (rows.some((row) => !seen.has(row.id))) {
      setSeen((current) => new Set([...current, ...rows.map((row) => row.id)]))
    }
  }, [rows, seen])
  const total = Math.max(seen.size, rows.length)

  return (
    <PromptFrame contentKey={question.id} fromHeight={fromHeight}>
      <QuestionCard
        // Keyed by the question: a selection or a half-written answer made for
        // one question must never be found still holding on the next.
        key={question.id}
        question={question}
        progress={{ at: total - rows.length + 1, of: total }}
        answering={answeringId === question.id}
        onAnswer={(answer) => onAnswer(question.id, answer)}
        onStop={onStop}
      />
    </PromptFrame>
  )
}

function QuestionCard({
  question,
  progress,
  answering,
  onAnswer,
  onStop,
}: {
  readonly question: PendingQuestionRecord
  readonly progress: { readonly at: number; readonly of: number }
  readonly answering: boolean
  readonly onAnswer: (answer: Answer) => Promise<void>
  readonly onStop: (() => void) | null
}) {
  const { payload } = question
  const recommended = payload.options.findIndex((option) => option.id === payload.recommendedOptionId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([])
  const [text, setText] = useState('')
  const [advancing, setAdvancing] = useState(false)
  const advancingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (advancingTimer.current !== null) clearTimeout(advancingTimer.current)
    }
  }, [])

  const commit = (answer: Answer) => {
    void onAnswer(answer)
  }

  /** The answer the send button would give, or null when there is nothing to send. */
  const pendingAnswer = (): Answer | null => {
    const written = text.trim()
    if (written !== '') return { text: written }
    if (payload.multiSelect && checkedIds.length > 0) return { optionIds: checkedIds }
    return null
  }

  const choose = (optionId: string) => {
    if (advancing || answering) return
    if (payload.multiSelect) {
      setCheckedIds((current) =>
        current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
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

  const send = () => {
    if (advancing || answering) return
    const answer = pendingAnswer()
    if (answer !== null) commit(answer)
  }

  return (
    <CardShell
      header={payload.header}
      progress={progress}
      onSkip={() => {
        if (!answering && !advancing) commit({ deferred: true })
      }}
      sentence={payload.question}
      detail={payload.multiSelect ? 'Choose all that apply.' : null}
      // The countdown is the row's own deadline. A question that will wait
      // forever gets no timer, because a timer on it would be a lie.
      deadline={question.expiresAt}
      bodyLabel="Answers"
      // The recommendation is lit on arrival, otherwise the first answer, so
      // the description slot always has something to say. Lit is not chosen:
      // nothing answers until a person does.
      initialActive={recommended === -1 ? 0 : recommended}
      descriptions={payload.options.map((option) => option.description)}
      body={payload.options.map((option, at) => (
        <OptionRow
          key={option.id}
          index={at}
          label={option.label}
          selected={payload.multiSelect ? checkedIds.includes(option.id) : selectedId === option.id}
          onSelect={() => choose(option.id)}
          kind={payload.multiSelect ? 'checkbox' : 'radio'}
          disabled={advancing || answering}
        />
      ))}
      foot={
        <AnswerField
          value={text}
          onChange={setText}
          onSend={send}
          sendLabel={text.trim() === '' && payload.multiSelect ? 'Send choices' : 'Send answer'}
          canSend={pendingAnswer() !== null}
          onStop={onStop}
          disabled={advancing}
          busy={answering}
        />
      }
      canSubmit={pendingAnswer() !== null}
      onSubmit={send}
      answering={answering}
    />
  )
}
