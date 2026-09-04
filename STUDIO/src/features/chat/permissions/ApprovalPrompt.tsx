import { useState, type ReactNode } from 'react'

import { Button, Segmented } from '@/components/primitives'
import { CardShell } from '@/features/chat/questions/CardShell'
import type { PermissionQuestion, QuestionTextPart } from '@/domain/permissions/question'
import type { ApprovalAnswer, GrantDuration } from '@/platform/harness'

/**
 * The question Studio stops and asks, in the conversation, where the run
 * stopped.
 *
 * ---- What this is not ------------------------------------------------------
 *
 * Not a dialog floating over the app, and not the ask-a-question tool. It is
 * consent for an action a run is already attempting: the run is parked, the
 * transcript holds whatever it produced before the ask, and this sits between
 * that transcript and the composer - in the flow, at the point the turn
 * stopped - because that is where the person's attention already is.
 *
 * ---- The shape -------------------------------------------------------------
 *
 * The sentence says what is being asked for - the capability and the thing it
 * touches, never the capability id - and the controls below it are the two
 * answers the harness accepts: a verdict and how long an allow lasts. The
 * narrowest duration is selected first, so a hurried Enter answers with the
 * smallest grant on offer. `always` is a real grant that outlives the
 * conversation, and naming that consequence is what makes it read as the
 * heavier choice rather than a third setting on a dial.
 *
 * A deny is an ordinary outcome, not a refusal to be styled as an error: the
 * model receives the verdict and keeps going, so Deny sits at the same calm
 * weight as every ghost control in the app.
 *
 * Several questions can wait at once. The harness parks on them in the order
 * the call named its resources - one question per program on a command line -
 * so the oldest is the active one and the rest are named beneath it, answered
 * one at a time in the order the run will consume them.
 *
 * ---- What moved, and what did not ------------------------------------------
 *
 * The rendering lives on the shared card shell now, because a question about
 * a decision and a question about consent stop the same run in the same
 * place and must not drift into two different-looking things. What the shell
 * can reach is presentation only: the framing, the sentence, the control row,
 * the footnotes, and the Enter key. The broker, the kernel, the verdict and
 * duration vocabulary, and the preselected narrowest duration are untouched -
 * and the shell takes no deadline from this caller, because a permission
 * question cannot time out and has no default, ever.
 */
export function ApprovalPrompt({
  questions,
  answeringId,
  onAnswer,
}: {
  /** This conversation's pending questions, oldest first; non-empty by contract. */
  readonly questions: readonly PermissionQuestion[]
  /** The question an answer is currently in flight for, if any. */
  readonly answeringId: string | null
  readonly onAnswer: (id: string, answer: ApprovalAnswer) => Promise<void>
}) {
  const question = questions[0]
  const waiting = questions.slice(1)

  // The narrowest grant first: a person pressing Enter at the default answers
  // with the smallest thing on offer.
  const [duration, setDuration] = useState<GrantDuration>('once')
  const [verdictInFlight, setVerdictInFlight] = useState<ApprovalAnswer['verdict'] | null>(null)
  const answering = answeringId === question.id

  // A lasting answer is stored against the folder the kernel offered, not
  // against the one file the run happened to name first - otherwise "this
  // conversation" asks again about the very next file. "Just once" stores
  // nothing, so it stays at the narrowest rung. See `lastingScopeId`.
  const scopeId = duration === 'once' ? undefined : (question.lastingScopeId ?? undefined)

  const respond = (verdict: ApprovalAnswer['verdict']) => {
    setVerdictInFlight(verdict)
    void onAnswer(question.id, {
      verdict,
      duration,
      ...(scopeId === undefined ? {} : { scopeId }),
    })
  }

  return (
    <CardShell
      header="Permission"
      sentence={question.sentence.map(renderPart)}
      detail={question.reason}
      // No deadline is not a missing argument here; it is the whole rule.
      // The shell draws no countdown without one, and this caller has none
      // to give: a permission question cannot time out and has no default.
      deadline={null}
      controls={
        <>
          <Segmented
            layoutId="approval-duration"
            ariaLabel="How long this answer lasts"
            value={duration}
            onChange={setDuration}
            options={[
              { id: 'once' as const, label: 'Just once' },
              { id: 'conversation' as const, label: 'This conversation' },
              { id: 'always' as const, label: 'Always' },
            ]}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={answering}
              busy={answering && verdictInFlight === 'deny'}
              onClick={() => respond('deny')}
            >
              Deny
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={answering}
              busy={answering && verdictInFlight === 'allow'}
              onClick={() => respond('allow')}
            >
              Allow
            </Button>
          </div>
        </>
      }
      canSubmit={!answering}
      // Enter allows, at the preselected narrowest duration: the same answer
      // the controls' default state is already holding.
      onSubmit={() => respond('allow')}
      answering={answering}
      footnotes={
        <>
          {duration === 'once' ? null : (
            <p className="max-w-[60ch] text-caption text-muted-foreground">
              {consequence(duration, scopeId !== undefined)}
            </p>
          )}
          {waiting.length > 0 ? (
            <p className="max-w-[60ch] text-caption text-muted-foreground">
              Also waiting, one at a time:{' '}
              {waiting.map((item, at) => (
                <span key={item.id}>
                  {at > 0 ? ', ' : ''}
                  {item.sentence.map(renderPart)}
                </span>
              ))}
            </p>
          ) : null}
        </>
      }
    />
  )
}

/**
 * What the person is actually agreeing to, said before they agree to it.
 *
 * The duration alone does not describe the grant: how long it lasts and how
 * much it covers are two different questions, and the second one is the one
 * that surprises people. A folder-wide answer says so; a question that offers
 * no folder rung - a command, approved by program name - says that instead,
 * because "this folder" would be a lie about what was stored.
 */
function consequence(duration: GrantDuration, folder: boolean): string {
  if (duration === 'conversation') {
    return folder
      ? 'Studio stops asking about this folder for the rest of this conversation.'
      : 'Studio stops asking about this for the rest of this conversation.'
  }
  return folder
    ? 'Studio stops asking about this folder, in this conversation and in later ones.'
    : 'Studio stops asking about this, in this conversation and in later ones.'
}

/**
 * The action sentence, part by part. A code part is the thing being touched -
 * a file name, a program - and wears the same mono face inline code wears in
 * the transcript, so "a thing named exactly as it is on disk" looks the same
 * wherever it is said.
 */
function renderPart(part: QuestionTextPart, at: number): ReactNode {
  if (part.kind === 'code') {
    return (
      <code
        key={at}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--code-size)' }}
        className="rounded-sm bg-code-surface px-1"
      >
        {part.text}
      </code>
    )
  }
  return <span key={at}>{part.text}</span>
}
