import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Tooltip } from '@/components/primitives'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import { cn } from '@/lib/cn'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { isRecord } from '@/lib/guards'
import { ROW_GAP_MARGIN } from './rowGap'

/**
 * What the person answered, as one line in the transcript where they answered.
 *
 * ---- Why a row, and why outside the work ----------------------------------
 *
 * The answers are the person's decisions, and everything the run did after
 * them followed from them; when the work goes wrong, what was said here is the
 * first thing to check. Inside the activity block they folded away with the
 * work, two disclosures deep, which is where the transcript used to lose them.
 * Standing open as a block they were the loudest thing in a turn that was
 * mostly tool work. So the record is a single row in the tool rows' own shape:
 * the ask mark, then the answers themselves, read at a glance -
 * "Answered · Email · Rust, TypeScript · 1 skipped" - and opening onto each
 * question with its full answer. It is a standalone slot (`toolPresentation`),
 * so it stays visible when a settled turn folds its work away.
 *
 * Each question in the body is two lines: the question in the quiet voice,
 * then the answer in the foreground behind the card's own arrow. A written
 * answer is shown whole, line breaks and all.
 *
 * Nothing shows while the call is still waiting: the card is on screen then,
 * and a second copy of the question above it would be the same thing twice.
 *
 * ---- What the answer looks like on the wire --------------------------------
 *
 * The tool returns an object, but the model reads tool results as text, so the
 * harness serialises it, and the conversation's projection hands the client
 * that lone text block as the call's output - a JSON string, not the object.
 * Both are read here. Reading only the object made a live call's record
 * vanish entirely, since every real answer arrived as the string.
 */
export function QuestionAnswers({
  call,
  live = false,
  textBefore = false,
  textAfter = false,
  rowBefore = false,
}: {
  readonly call: ToolCallView
  /** Arriving with a live turn, so the row takes the house entrance. */
  readonly live?: boolean
  /** Words stand directly above or below, so the row takes a tool row's margin. */
  readonly textBefore?: boolean
  readonly textAfter?: boolean
  /** Another row stands directly above: the one row gap (`ROW_GAP_MARGIN`). */
  readonly rowBefore?: boolean
}) {
  const [open, setOpen] = useState(false)
  const asked = questionsOf(call.input)
  const answered = call.output !== null && call.output.present
  if (asked.length === 0) return null
  if (!answered && call.errorText === null) return null
  const reports = reportsOf(call.output)
  const closing = closingOf(call.output)
  const line = summaryOf(reports, call.errorText !== null)

  return (
    <DisclosureRow
      className={cn('min-w-0', textBefore && 'mt-4', textAfter && 'mb-4', rowBefore && ROW_GAP_MARGIN)}
      entering={live}
      leading={<Icons.ask />}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      chevron="hover"
      // Hung under the row's words, not flush at the edge: flush, the
      // questions read as rows of their own and the next row - a thought, a
      // tool - looked like one more answer in the list. A rule fixed that but
      // drew a divider; the indent and the breath below do it without one.
      hang
      label={
        <Tooltip label={line} overflowOnly className="min-w-0">
          <span className="min-w-0 truncate">{line}</span>
        </Tooltip>
      }
    >
      <div role="group" aria-label="Your answers" className="flex flex-col gap-2.5 pt-0.5 text-ui">
        {asked.map((question, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-foreground">{question}</span>
            <AnswerLine report={reports?.[index]} failed={call.errorText !== null} />
          </div>
        ))}
        {closing !== null ? <span className="text-caption text-muted-foreground">{closing}</span> : null}
      </div>
    </DisclosureRow>
  )
}

/**
 * The row's one line: the verb, then each answer as it would be read aloud,
 * with whatever was not answered counted at the end rather than listed.
 */
export function summaryOf(reports: readonly AnswerReport[] | null, failed: boolean): string {
  if (reports === null || reports.length === 0) return failed ? 'Question not answered' : 'Answered'
  const answers: string[] = []
  let skipped = 0
  let other: string | null = null
  for (const report of reports) {
    const answer = answerOf(report)
    if (answer !== null) answers.push(firstLine(answer))
    else if (report.outcome === 'deferred') skipped += 1
    else other ??= saidFor(report.outcome)
  }
  const parts = answers.length > 0 ? ['Answered', ...answers] : [other ?? (skipped > 0 ? 'Skipped' : 'Answered')]
  if (answers.length > 0 && skipped > 0) parts.push(`${skipped} skipped`)
  if (answers.length === 0 && skipped > 1) parts[0] = `Skipped ${skipped} questions`
  return parts.join(' · ')
}

function answerOf(report: AnswerReport): string | null {
  if (report.outcome !== 'answered') return null
  return report.text ?? (report.labels.length > 0 ? report.labels.join(', ') : null)
}

function firstLine(text: string): string {
  const [first = ''] = text.split('\n')
  return first.length < text.length ? `${first.trimEnd()}…` : first
}

function saidFor(outcome: string): string {
  return outcome === 'stopped' ? 'Stopped' : outcome === 'timed_out' ? 'Timed out' : outcome
}

export interface AnswerReport {
  readonly outcome: string
  readonly labels: readonly string[]
  readonly text: string | null
}

/** The answer: what was chosen or written, or what happened instead. */
function AnswerLine({ report, failed }: { readonly report: AnswerReport | undefined; readonly failed: boolean }) {
  if (report !== undefined) {
    const answer = answerOf(report)
    if (answer !== null) {
      return (
        <span className="flex min-w-0 items-start gap-2 font-medium text-foreground">
          {/* The card's own arrow, at the height of the first line. */}
          <span aria-hidden className="flex h-[1lh] shrink-0 items-center">
            <Icons.choose className="text-accent" />
          </span>
          <span className="studio-selectable min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{answer}</span>
        </span>
      )
    }
  }
  // The harness names what happened instead; these are its words, mapped
  // where the interface already had a name for them.
  const said =
    report === undefined
      ? failed ? 'Not answered' : 'Answered'
      : report.outcome === 'deferred'
        ? 'Skipped, left to the agent'
        : report.outcome === 'answered'
          ? 'Answered'
          : saidFor(report.outcome)
  return <span className="text-muted-foreground">{said}</span>
}

/** The questions as the model asked them, defensively read. */
function questionsOf(input: ToolCallView['input']): readonly string[] {
  if (input === null || !input.present) return []
  const value = recordOf(input.value)
  if (value === null) return []
  const raw = value['questions']
  if (!Array.isArray(raw)) return []
  const asked: string[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const question = entry['question']
    if (typeof question === 'string' && question.length > 0) asked.push(question)
  }
  return asked
}

/** How each question came out, from the call's answer, defensively read. */
function reportsOf(output: ToolCallView['output']): readonly AnswerReport[] | null {
  if (output === null || !output.present) return null
  const value = recordOf(output.value)
  if (value === null) return null
  const raw = value['questions']
  if (!Array.isArray(raw)) return null
  const reports: AnswerReport[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['outcome'] !== 'string') continue
    const labels = Array.isArray(entry['labels'])
      ? entry['labels'].filter((label): label is string => typeof label === 'string')
      : []
    reports.push({
      outcome: entry['outcome'],
      labels,
      text: typeof entry['text'] === 'string' ? entry['text'] : null,
    })
  }
  return reports
}

/** The run's closing sentence, when an older stop carried one. */
function closingOf(output: ToolCallView['output']): string | null {
  if (output === null || !output.present) return null
  const value = recordOf(output.value)
  if (value === null) return null
  const closing = value['closing']
  return typeof closing === 'string' && closing.length > 0 ? closing : null
}

/** The object itself, or the object a JSON string spells; null for anything else. */
function recordOf(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
