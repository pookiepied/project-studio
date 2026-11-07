import { useState, type ReactNode } from 'react'

import { CardShell, OptionRow } from '@/features/chat/questions/CardShell'
import { StopButton } from '@/features/chat/questions/PromptFoot'
import { PromptFrame } from '@/features/chat/questions/PromptFrame'
import type { PermissionQuestion, QuestionTextPart } from '@/domain/permissions/question'
import { agentAttribution } from '@/domain/permissions/question'
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
 * touches, never the capability id - and the rows below it are the answers the
 * harness accepts, each a verdict with how long it lasts, said in one line:
 * Allow once, Allow for this conversation, Always allow in this project, Deny.
 * The narrowest is lit first, so a hurried Enter answers with the smallest
 * grant on offer, and each wider row says what it stores before it is clicked. `always` is a real grant that outlives the
 * conversation - it holds for every conversation of the project - and
 * naming that consequence is what makes it read as the heavier choice
 * rather than a third setting on a dial. With no project it is not offered:
 * there is nothing beyond this conversation for it to mean.
 *
 * A deny is an ordinary outcome, not a refusal to be styled as an error: the
 * model receives the verdict and keeps going, so Deny is a row like the others.
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
  hasProject = true,
  onStop = null,
  fromHeight = null,
}: {
  /** This conversation's pending questions, oldest first; non-empty by contract. */
  readonly questions: readonly PermissionQuestion[]
  /**
   * Whether the conversation belongs to a project. "Always" means every
   * conversation in this project, and with no project there is nothing for
   * it to mean beyond "this conversation" - so the rung is not offered rather
   * than offered under a label that promises more than it stores.
   */
  readonly hasProject?: boolean
  /** The question an answer is currently in flight for, if any. */
  readonly answeringId: string | null
  readonly onAnswer: (id: string, answer: ApprovalAnswer) => Promise<void>
  /** Ends the run, as the composer's stop does; null where the surface has its own. */
  readonly onStop?: (() => void) | null
  /** The composer's height as it gave way, so the card opens from it. */
  readonly fromHeight?: number | null
}) {
  const question = questions[0]
  return (
    <PromptFrame contentKey={question.id} fromHeight={fromHeight}>
      <ApprovalCard
        // Keyed by the active question, so answering one and moving to the
        // next starts the card afresh: a row lit or in flight for the last
        // question must never be found holding on this one.
        key={question.id}
        questions={questions}
        answeringId={answeringId}
        onAnswer={onAnswer}
        hasProject={hasProject}
        onStop={onStop}
      />
    </PromptFrame>
  )
}

function ApprovalCard({
  questions,
  answeringId,
  onAnswer,
  hasProject,
  onStop,
}: {
  readonly questions: readonly PermissionQuestion[]
  readonly answeringId: string | null
  readonly onAnswer: (id: string, answer: ApprovalAnswer) => Promise<void>
  readonly hasProject: boolean
  readonly onStop: (() => void) | null
}) {
  const question = questions[0]
  const waiting = questions.slice(1)
  // S5.4's attribution: a delegate asks under its own name, so the header
  // says which agent is asking - the same fact the grant will be keyed to.
  // The conversation agent's own asks stay unattributed, which is its own
  // honest label: nothing here is someone else's name to borrow.
  const attribution = agentAttribution(question.agentId)

  const [inFlight, setInFlight] = useState<string | null>(null)
  const answering = answeringId === question.id

  // A lasting answer is stored against the folder the kernel offered, not
  // against the one file the run happened to name first - otherwise "this
  // conversation" asks again about the very next file. "Once" stores
  // nothing, so it stays at the narrowest rung. See `lastingScopeId`.
  const folder = question.lastingScopeId !== null
  const scopeFor = (duration: GrantDuration) =>
    duration === 'once' ? undefined : (question.lastingScopeId ?? undefined)

  // The answers, narrowest grant first: the first row is lit on arrival, so
  // a person pressing Enter answers with the smallest thing on offer. Nothing
  // longer than the kernel accepts is offered: it refuses a longer answer
  // outright rather than shortening it. A deny is answered once; it is an
  // ordinary outcome the run carries on from, not a rule to store.
  const answers: readonly Answer[] = [
    { id: 'once', verdict: 'allow', duration: 'once', label: 'Allow once', description: 'Studio asks again next time.' },
    ...(question.maxDuration === 'once'
      ? []
      : [{ id: 'conversation', verdict: 'allow', duration: 'conversation', label: 'Allow for this conversation', description: consequence('conversation', folder) } as const]),
    ...(hasProject && question.maxDuration === 'always'
      ? [{ id: 'always', verdict: 'allow', duration: 'always', label: 'Always allow in this project', description: consequence('always', folder) } as const]
      : []),
    { id: 'deny', verdict: 'deny', duration: 'once', label: 'Deny', description: 'The run is told no and carries on.' },
  ]

  const waitingLine =
    waiting.length > 0 ? (
      <p className="max-w-[60ch] text-caption text-muted-foreground">
        Also waiting, one at a time:{' '}
        {groupByAgent(waiting).map((group, at) => (
          <span key={group.agentId ?? 'conversation'}>
            {at > 0 ? ', ' : ''}
            {attribution === null && group.agentId !== null
              ? `the ${group.label.toLowerCase()} asks to `
              : ''}
            {group.items.map((item, itemAt) => (
              <span key={item.id}>
                {itemAt > 0 ? ' and ' : ''}
                {item.sentence.map(renderPart)}
              </span>
            ))}
          </span>
        ))}
      </p>
    ) : null

  const respond = (answer: Answer) => {
    if (answering) return
    setInFlight(answer.id)
    const scopeId = scopeFor(answer.duration)
    void onAnswer(question.id, {
      verdict: answer.verdict,
      duration: answer.duration,
      ...(scopeId === undefined ? {} : { scopeId }),
    })
  }

  return (
    <CardShell
      header={attribution === null ? 'Permission' : `Permission — ${attribution}`}
      sentence={question.sentence.map(renderPart)}
      detail={question.reason}
      // No deadline is not a missing argument here; it is the whole rule.
      // The shell draws no countdown without one, and this caller has none
      // to give: a permission question cannot time out and has no default.
      deadline={null}
      bodyLabel="How to answer"
      initialActive={0}
      descriptions={answers.map((answer) => answer.description)}
      body={answers.map((answer, at) => (
        <OptionRow
          key={answer.id}
          index={at}
          kind="action"
          label={answer.label}
          onSelect={() => respond(answer)}
          disabled={answering}
          busy={answering && inFlight === answer.id}
        />
      ))}
      canSubmit={!answering}
      // Enter on the card allows once: the answer the first row already holds.
      onSubmit={() => respond(answers[0])}
      answering={answering}
      aside={onStop === null ? null : <StopButton onStop={onStop} disabled={answering} />}
      foot={waitingLine === null ? null : <div className="px-2">{waitingLine}</div>}
    />
  )
}

interface Answer {
  readonly id: string
  readonly verdict: ApprovalAnswer['verdict']
  readonly duration: GrantDuration
  readonly label: string
  readonly description: string
}

/**
 * The waiting list, grouped by the agent each question belongs to (S5.4).
 *
 * The queue is still answered oldest first - grouping changes only how the
 * footnote reads, never the order the run will consume them. Within a
 * group the original order stands; the groups themselves appear in the
 * order each agent's first question arrived, so the display stays
 * traceable to the queue it renders.
 */
function groupByAgent(questions: readonly PermissionQuestion[]): {
  agentId: string | null
  label: string
  items: readonly PermissionQuestion[]
}[] {
  const groups: { agentId: string | null; label: string; items: PermissionQuestion[] }[] = []
  for (const question of questions) {
    const found = groups.find((group) => group.agentId === question.agentId)
    if (found !== undefined) {
      found.items.push(question)
      continue
    }
    groups.push({
      agentId: question.agentId,
      label: agentAttribution(question.agentId) ?? 'conversation agent',
      items: [question],
    })
  }
  return groups
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
    ? 'Studio stops asking about this folder in every conversation of this project.'
    : 'Studio stops asking about this in every conversation of this project.'
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
        // The transcript's own inline-code chip -- muted, not the code-panel
        // ground. The panel colour is the one that darkens in dark mode (a
        // code block is inset "further from the light"), which turned this
        // chip into a black patch on the raised card.
        className="rounded-xs bg-muted px-1"
      >
        {part.text}
      </code>
    )
  }
  return <span key={at}>{part.text}</span>
}
