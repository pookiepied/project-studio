import { useState } from 'react'
import { Icons } from '@/components/icons'
import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { cn } from '@/lib/cn'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'

import { netOf } from './groupNet'
import { anchorToRegion, parseFileToolOutcome, type FileToolOutcome } from './editOutcome'
import { diffLines, wholeFileDiff, type LineDiff } from './diffLines'
import { FileDiff } from './FileDiff'
import { RollingCount } from './RollingCount'

import type { ToolCallView, ToolGroupView } from '@/features/chat/transcript/projection'

/**
 * A turn's tool calls, one row per event the reader follows.
 *
 * Most rows are what they always were: one call, one chip -- the verb the
 * call performs, the file or command it acts on, the count its own input
 * carries. The exception is the file run: a maximal line of consecutive
 * same-file mutating calls is ONE row -- two or more of them, that is; a
 * single call is a single chip, and a run of one is the log wearing a group's
 * clothes for an event that needs none -- because four edits to one file are
 * one story, and four identical chips telling it in fragments is the log
 * wearing the reader down. A chip that receives a second same-file call
 * becomes a run in place, and the entrance the reader then sees is the run's,
 * which is the honest reading of it: an event that became a story. While the
 * run is still receiving -- it is the
 * segment's last run and the turn is being written now -- its row stays
 * expanded and its numbers tick in place: the count of edits climbs, the
 * diffstat moves, and when the run closes everything freezes, so the row
 * reads as the event it was.
 *
 * ---- Every word on a chip is a fact ---------------------------------------
 *
 * The verb is the tool's own name humanized and tensed by what the log
 * knows; a tool name the map has never heard of renders under its raw name
 * -- shown, not guessed at. The diffs are computed from the input the model
 * sent, by field name, never inferred. The header's diffstat is the run's
 * NET when the run's own inputs prove it (see `netOf`) and the calls'
 * summed churn when they do not -- the tooltip names which one it is.
 *
 * What no chip claims: what the call did to the file on disk (only the
 * harness would know, and it does not say), a line number the log does not
 * carry, an outcome the log has not reported.
 */
export function ToolGroups({
  groups,
  live = false,
}: {
  groups: readonly ToolGroupView[]
  /**
   * This turn is being written right now. Rows arriving with the turn enter
   * on the house fade; a run still receiving keeps itself open and its
   * numbers animate; a replayed turn is history -- nothing moves, and a call
   * it left unanswered reads as "pending", which is all that is known.
   */
  live?: boolean
}) {
  // The segment's LAST file row is the question: nothing mutating has landed
  // after it. Reads do not close a run -- the retry pattern re-reads the file
  // mid-edit -- but any file row after a run closes it, a single-call row as
  // much as a run, so the scan stops there. A closed row hands the receiving
  // flag to nobody: a chip carries its own working state, and a run that the
  // log has moved past is history, not an event in progress.
  let receivingId: string | null = null
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (group === undefined) continue
    if (group.file !== null) {
      if (group.calls.length > 1) receivingId = group.id
      break
    }
  }
  return (
    <div className="my-1 flex flex-col gap-0.5">
      {groups.map((group) =>
        group.file !== null && group.calls.length > 1 ? (
          <FileRunRow
            key={group.id}
            group={group}
            live={live}
            receiving={live && group.id === receivingId}
          />
        ) : (
          group.calls.map((call) => <ToolCallRow key={call.toolCallId} call={call} live={live} />)
        ),
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The action map                                                              */
/* -------------------------------------------------------------------------- */

interface ToolAction {
  /** The registry mark bound to this action. */
  readonly mark: (typeof Icons)[keyof typeof Icons]
  /** The verb while the call is running -- what it is doing. */
  readonly running: string
  /** The verb once the call has its answer -- what it did. */
  readonly done: string
}

/**
 * Tool name to action. The keys are the harness's own registry -- native
 * tools reach the wire under their bare names (`shell`, `glob`), MCP tools
 * under an encoded `mcp__` name no map should pretend to know. Marks reuse
 * the registry's concepts on purpose: the globe is the web wherever it
 * appears, the branch is git, a question is the question mark.
 */
const ACTIONS: Readonly<Record<string, ToolAction>> = {
  read: { mark: Icons.fileRead, running: 'Reading', done: 'Read' },
  write: { mark: Icons.fileWrite, running: 'Writing', done: 'Wrote' },
  edit: { mark: Icons.edit, running: 'Editing', done: 'Edited' },
  shell: { mark: Icons.run, running: 'Running', done: 'Ran' },
  git: { mark: Icons.branch, running: 'Running', done: 'Ran' },
  glob: { mark: Icons.search, running: 'Searching', done: 'Searched' },
  grep: { mark: Icons.search, running: 'Searching', done: 'Searched' },
  web_search: { mark: Icons.search, running: 'Searching', done: 'Searched' },
  fetch: { mark: Icons.browserUse, running: 'Fetching', done: 'Fetched' },
  plan: { mark: Icons.plan, running: 'Planning', done: 'Planned' },
  ask_user_question: { mark: Icons.ask, running: 'Asking', done: 'Asked' },
}

/** The tools whose subject is a file path, and so earns the file's own mark. */
const FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit'])

function answeredOf(call: ToolCallView): boolean {
  return call.output !== null && call.output.present
}

/* -------------------------------------------------------------------------- */
/* The file run                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One same-file mutating run, as one row.
 *
 * The collapse rule has three masters, in order: a run still receiving is
 * open, so the ticking is actually visible; a closed run collapses, because
 * a finished event reads better shut; and the reader's own toggle always
 * wins, permanently -- an auto-state never overrides a hand.
 */
function FileRunRow({
  group,
  live,
  receiving,
}: {
  group: ToolGroupView
  live: boolean
  receiving: boolean
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const file = group.file
  if (file === null) return null

  const calls = group.calls
  const diffs = calls.map((call) => (call.errorText !== null ? null : diffOf(call)))
  let churned = { added: 0, removed: 0 }
  for (const diff of diffs) {
    if (diff !== null) churned = { added: churned.added + diff.added, removed: churned.removed + diff.removed }
  }
  // A failed call changed nothing, so it appears as a child and counts nowhere.
  const net = netOf(calls)
  const stat = net ?? churned
  const running = live && calls.some((call) => call.errorText === null && !answeredOf(call))
  const hasEdits = calls.some((call) => call.toolName === 'edit')
  const hasWrites = calls.some((call) => call.toolName === 'write')
  const action = hasEdits ? ACTIONS.edit : ACTIONS.write
  const noun = hasEdits && hasWrites ? 'change' : hasEdits ? 'edit' : 'write'
  const open = userOpen ?? receiving

  return (
    <DisclosureRow
      leading={<action.mark />}
      entering={live}
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'shrink-0',
              running && 'studio-shimmer inline-block whitespace-nowrap',
            )}
          >
            {running ? action.running : action.done}
          </span>
          <FileTypeMark path={file} />
          <FileSubject path={file} />
          <span className="shrink-0 text-muted-foreground">
            {/* The count ticks with the run: RollingCount mounts at the fact
                for history and climbs for a run being written now. */}
            {calls.length} {noun}s
          </span>
          <span
            className="shrink-0 font-mono"
            title={net !== null ? 'net lines changed' : 'lines touched'}
          >
            <span className="text-diff-add">
              +<RollingCount value={stat.added} live={running} />
            </span>{' '}
            <span className="text-diff-del">
              -<RollingCount value={stat.removed} live={running} />
            </span>
          </span>
        </span>
      }
      open={open}
      onToggle={() => setUserOpen(!open)}
      chevron="hover"
      flush
    >
      <div className="flex flex-col gap-1">
        {net !== null ? (
          <div>
            <p className="mb-1 text-caption text-muted-foreground">
              net -- the file as the run's first call found it, and as its last left it
            </p>
            <FileDiff path={file} diff={net} />
          </div>
        ) : null}
        {calls.map((call, index) => (
          <GroupCallRow
            key={call.toolCallId}
            call={call}
            file={file}
            ordinal={index + 1}
            live={live}
          />
        ))}
      </div>
    </DisclosureRow>
  )
}

/** One call of a run, expanded: its own diff and its own answer, as it happened. */
function GroupCallRow({
  call,
  file,
  ordinal,
  live,
}: {
  call: ToolCallView
  file: string
  ordinal: number
  live: boolean
}) {
  const [open, setOpen] = useState(false)
  const failed = call.errorText !== null
  const outcome = outcomeOf(call)
  const rawDiff = failed ? null : diffOf(call)
  // The same anchoring the chip applies: an edit's gutters carry the
  // harness echo's line numbers only where the echo corroborates the rows.
  // One fact, one rendering, wherever the call is shown.
  const diff =
    rawDiff !== null && outcome !== null && outcome.region.length > 0
      ? anchorToRegion(rawDiff, outcome.region)
      : rawDiff
  const action = ACTIONS[call.toolName]
  const verb = action === undefined ? call.toolName : answeredOf(call) || failed ? action.done : action.running

  return (
    <DisclosureRow
      entering={live}
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 tabular-nums text-muted-foreground/70">{ordinal}</span>
          <span className={cn('shrink-0', failed && 'text-danger')}>
            {/* A refused call is an event that happened: named, counted in
                nothing, its working-out below. */}
            {failed ? 'failed' : verb}
          </span>
          {diff !== null ? (
            <span className="shrink-0 font-mono">
              <span className="text-diff-add">+{diff.added}</span>{' '}
              <span className="text-diff-del">-{diff.removed}</span>
            </span>
          ) : null}
        </span>
      }
      open={open}
      onToggle={() => setOpen((value) => !value)}
      chevron="hover"
      flush={diff !== null}
    >
      <CallWorkingOut call={call} diff={diff} file={file} outcome={outcome} />
    </DisclosureRow>
  )
}

/* -------------------------------------------------------------------------- */
/* The single call                                                             */
/* -------------------------------------------------------------------------- */

function ToolCallRow({ call, live }: { call: ToolCallView; live: boolean }) {
  const [open, setOpen] = useState(false)
  const action = ACTIONS[call.toolName]
  const subject = subjectOf(call)
  const file = FILE_TOOLS.has(call.toolName) ? subject : null
  const outcome = outcomeOf(call)
  const rawDiff = diffOf(call)
  // An edit's answer echoes the changed span with its real line numbers; the
  // card takes them (when the echo corroborates the rows) and the display
  // never prints the echo twice.
  const diff =
    rawDiff !== null && outcome !== null && outcome.region.length > 0
      ? anchorToRegion(rawDiff, outcome.region)
      : rawDiff
  const answered = answeredOf(call)
  const running = call.errorText === null && !answered
  const verb = action === undefined ? call.toolName : running ? action.running : action.done

  return (
    <DisclosureRow
      leading={action === undefined ? undefined : <action.mark />}
      entering={live}
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The one moving thing on a live chip, as on a live trace: the
              words themselves, not a spinner beside them. */}
          <span
            className={cn(
              'shrink-0',
              running && live && 'studio-shimmer inline-block whitespace-nowrap',
            )}
          >
            {verb}
          </span>
          {file !== null ? <FileTypeMark path={file} /> : null}
          {file !== null ? (
            <FileSubject path={file} />
          ) : subject !== null ? (
            <span className="truncate">{subject}</span>
          ) : null}
          {diff !== null ? (
            <span className="shrink-0 font-mono">
              {/* The added count arrives on a live chip (see RollingCount);
                  the removed count is the same fact at rest as it is in
                  motion, so it simply stands. */}
              <span className="text-diff-add">
                +<RollingCount value={diff.added} live={running && live} />
              </span>{' '}
              <span className="text-diff-del">-{diff.removed}</span>
            </span>
          ) : null}
          {call.errorText !== null ? (
            <span className="shrink-0 text-danger">failed</span>
          ) : running && !live ? (
            // The turn is over and the answer never came. The shimmer is the
            // running claim and it belongs to a live turn only; what is known
            // here is less, so it says less: pending.
            <span className="shrink-0 opacity-60">pending</span>
          ) : null}
        </span>
      }
      open={open}
      onToggle={() => setOpen((value) => !value)}
      chevron="hover"
      // A diff arrives as its own framed card, so the body stands flush: the
      // rule would draw a second edge a hand's width from the card's, and
      // the indent would park the diff off the boundary every other response
      // element shares. Loose working-out keeps the rule.
      flush={diff !== null && file !== null}
    >
      <CallWorkingOut call={call} diff={diff} file={file} outcome={outcome} />
    </DisclosureRow>
  )
}

/**
 * What opens under a chip: the call's working-out, in the shape its own kind
 * names. A file-writing call shows the diff it described and the harness's
 * own sentence; a question call shows each question and the exact answer
 * it was given; everything else shows the raw input and answer, pretty-
 * printed but untouched.
 */
function CallWorkingOut({
  call,
  diff,
  file,
  outcome,
}: {
  call: ToolCallView
  diff: LineDiff | null
  file: string | null
  outcome: FileToolOutcome | null
}) {
  const diffed = diff !== null && file !== null
  return (
    <div className="flex flex-col gap-1">
      {diffed ? (
        <FileDiff path={file} diff={diff} />
      ) : call.toolName === 'ask_user_question' ? (
        <AskWorkingOut call={call} />
      ) : (
        <div className="font-mono text-code text-muted-foreground">
          <Detail label="in" value={call.input} />
        </div>
      )}
      {call.errorText !== null ? (
        <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-code text-danger">
          {call.errorText}
        </pre>
      ) : call.output !== null && call.output.present ? (
        diffed && outcome !== null ? (
          // The harness's sentence -- "Edited snake/script.js", or write's
          // "Created directory snake, which did not exist." -- and nothing
          // more. An edit's answer used to continue into a numbered echo of
          // the changed span, printed here under the card that already is
          // that span; a one-line change read twice, the second copy a slab
          // of the file the card had rendered properly. The sentence stays,
          // because it is the harness speaking and write's sentences carry
          // facts the card does not; the echo is the card, whose gutters now
          // carry the echo's own numbers.
          <OutcomeSentence outcome={outcome} />
        ) : call.toolName === 'ask_user_question' ? null : (
          <div className="font-mono text-code text-muted-foreground">
            <Detail label="out" value={call.output} />
          </div>
        )
      ) : null}
    </div>
  )
}

/** The harness's prose: its opening sentence, then anything else it said. */
function OutcomeSentence({ outcome }: { outcome: FileToolOutcome }) {
  const sentence = [outcome.status, ...outcome.extra].join('\n')
  if (sentence.trim() === '') return null
  return (
    <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-code text-muted-foreground">
      {sentence}
    </pre>
  )
}

/** A file path, split where the eye already reads it: the name, then the way to it. */
function FileSubject({ path }: { path: string }) {
  const { name, dir } = splitFilePath(path)
  return (
    <>
      <span className="shrink-0 font-medium text-foreground">{name}</span>
      {dir !== null ? <span className="truncate text-muted-foreground">{dir}</span> : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The question and its answer                                                 */
/* -------------------------------------------------------------------------- */

interface AskedQuestion {
  readonly question: string
}

interface QuestionAnswerReport {
  readonly outcome: string
  readonly labels: readonly string[]
  readonly text: string | null
}

/** The questions as the model asked them, defensively read. */
function questionsOf(input: { readonly present: boolean; readonly value: unknown } | null): readonly AskedQuestion[] {
  if (input === null || !input.present) return []
  const value: unknown = input.value
  if (!isRecord(value)) return []
  const raw = value['questions']
  if (!Array.isArray(raw)) return []
  const asked: AskedQuestion[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const question = entry['question']
    if (typeof question === 'string' && question.length > 0) asked.push({ question })
  }
  return asked
}

/** How each question came out, from the call's answer, defensively read. */
function reportsOf(
  output: { readonly present: boolean; readonly value: unknown } | null,
): readonly QuestionAnswerReport[] | null {
  if (output === null || !output.present) return null
  const value: unknown = output.value
  if (!isRecord(value)) return null
  const raw = value['questions']
  if (!Array.isArray(raw)) return null
  const reports: QuestionAnswerReport[] = []
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

/** The run's closing sentence, when the person's stop carried one. */
function closingOf(
  output: { readonly present: boolean; readonly value: unknown } | null,
): string | null {
  if (output === null || !output.present) return null
  const value: unknown = output.value
  if (!isRecord(value)) return null
  const closing = value['closing']
  return typeof closing === 'string' && closing.length > 0 ? closing : null
}

/**
 * The record of a question call: what was asked, and -- once the person has
 * spoken -- the exact words or options they answered with, read from the
 * call's own answer. This is the part the transcript used to lose: the live
 * card takes the answers and the run moves on, and nothing on screen said
 * which shoe size was chosen. The answer is the fact this expansion exists
 * to hold, so it is the one line set in the foreground.
 */
function AskWorkingOut({ call }: { call: ToolCallView }) {
  const asked = questionsOf(call.input)
  const reports = reportsOf(call.output)
  const closing = closingOf(call.output)
  return (
    <div className="flex flex-col gap-2 text-ui">
      {asked.map((question, index) => (
        <div key={index} className="flex flex-col gap-0.5">
          <span className="text-caption leading-relaxed text-muted-foreground">
            {question.question}
          </span>
          <AnswerView report={reports?.[index]} />
        </div>
      ))}
      {closing !== null ? (
        <span className="text-caption text-muted-foreground">{closing}</span>
      ) : null}
    </div>
  )
}

/** The answer line: what was chosen, or what happened instead of a choice. */
function AnswerView({ report }: { report: QuestionAnswerReport | undefined }) {
  if (report === undefined) return null
  if (report.outcome === 'answered') {
    const answer = report.text ?? (report.labels.length > 0 ? report.labels.join(' · ') : null)
    if (answer === null) return null
    return <span className="font-medium text-foreground">{answer}</span>
  }
  // The harness names what happened instead; these are its words, mapped
  // where the interface already had a name for them.
  const said =
    report.outcome === 'deferred'
      ? 'You decide'
      : report.outcome === 'stopped'
        ? 'Stopped'
        : report.outcome === 'timed_out'
          ? 'Timed out'
          : report.outcome
  return <span className="text-muted-foreground">{said}</span>
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The diff a call's own input describes, or null. Recognised by field name,
 * exactly as `subjectOf` works, and only for the tools those fields belong
 * to: a `write` carries the whole file, an `edit` carries the two strings
 * the change is made of. Anything else -- an unknown tool, a missing input,
 * a field that is not a string -- yields null, and the call falls back to
 * showing what was actually sent.
 */
function diffOf(call: ToolCallView): LineDiff | null {
  if (call.input === null || !call.input.present) return null
  const input: unknown = call.input.value
  if (!isRecord(input)) return null
  if (call.toolName === 'write') {
    const content = firstString(input, ['content', 'contents'])
    return content === null ? null : wholeFileDiff(content)
  }
  if (call.toolName === 'edit') {
    // The harness's own field names are the camelCase pair; the snake_case
    // spellings stand for other harnesses whose edit is shaped the same way.
    const oldText = firstString(input, ['oldString', 'old_string', 'old_str', 'original'])
    const newText = firstString(input, ['newString', 'new_string', 'new_str', 'replacement'])
    return oldText === null || newText === null ? null : diffLines(oldText, newText)
  }
  return null
}

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    // Emptiness is a fact here, not an absence: a write of an empty file and
    // a pure-insertion edit both carry "" and both deserve their diff, so
    // only a missing or non-string field counts as nothing.
    if (typeof value === 'string') return value
  }
  return null
}

/** The call's answer when it is the harness's prose, parsed; null otherwise. */
function outcomeOf(call: ToolCallView): FileToolOutcome | null {
  if (call.output === null || !call.output.present) return null
  const value: unknown = call.output.value
  return typeof value === 'string' ? parseFileToolOutcome(value) : null
}

/**
 * The one fact worth showing as the chip's object: which file, which command
 * -- taken from the input the model actually sent, by field name, never
 * inferred. A question call's object is its first question's header, with
 * the count beside it when more than one was asked.
 */
function subjectOf(call: ToolCallView): string | null {
  if (call.input === null || !call.input.present) return null
  const input: unknown = call.input.value
  if (!isRecord(input)) return typeof input === 'string' && input.length > 0 ? input : null
  if (call.toolName === 'ask_user_question') return askSubject(input)
  for (const key of ['path', 'file_path', 'command', 'pattern', 'query', 'url']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function askSubject(input: Record<string, unknown>): string | null {
  const questions = input['questions']
  if (!Array.isArray(questions) || questions.length === 0) return null
  const first = questions[0]
  if (!isRecord(first)) return null
  const header = first['header']
  if (typeof header !== 'string' || header.length === 0) return null
  return questions.length > 1 ? `${header} +${questions.length - 1}` : header
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function Detail({
  label,
  value,
}: {
  label: string
  value: { readonly present: boolean; readonly value: unknown } | null
}) {
  if (value === null || !value.present) return null
  // A string answer renders as itself: a read's numbered lines and a shell
  // command's output are text to show, not data to quote -- JSON-quoting
  // them escaped every newline into a `\n` and turned a page of output into
  // one unbreakable line. Only structured answers print as JSON.
  const rendered = typeof value.value === 'string' ? value.value : jsonOf(value.value)
  return (
    <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere]">
      {label}: {rendered}
    </pre>
  )
}

function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
