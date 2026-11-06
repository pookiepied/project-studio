import { useState } from 'react'
import { Icons } from '@/components/icons'
import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { ShowMoreButton } from '@/components/primitives'
import { SiteMark } from '@/features/artifacts/kinds/SiteMark'
import { cn } from '@/lib/cn'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'

import { familyOf } from './reportFamily'
import { anchorToRegion, parseFileToolOutcome, type FileToolOutcome } from './editOutcome'
import { parseSearchOutcome, parseSearchQuery, type SearchOutcome, type SearchQuery } from './searchOutcome'
import { SearchQueryLine, SearchResults } from './SearchResults'
import { diffLines, wholeFileDiff, type LineDiff } from './diffLines'
import { FileDiff } from './FileDiff'
import { FileOperation, fileOperationOf } from './FileOperation'
import { GenericToolDetails, StructuredValue, ToolResultPanel } from './ToolResultPanel'
import { DiscoveryDetails, PlanDetails, ShellDetails } from './NativeToolDetails'
import { readableName, resultState } from './toolResult'
import { AgentTaskDetails } from './tools/AgentTaskDetails'
import { JobsDetails } from './tools/JobsDetails'
import { LibraryDetails } from './tools/LibraryDetails'
import { ExtensionToolDetails } from './tools/ExtensionToolDetails'
import { RollingCount } from './RollingCount'
import { ImageReads, readImages, type ReadImage } from './ImageReads'
import { BrowserReport } from './BrowserReport'
import { readWebCall } from './webCall'
import { toolPresentation } from './toolPresentation'
import { hostOf } from '@/lib/url'

import type { ToolCallView, ToolGroupView } from '@/features/chat/transcript/projection'
import { isRecord } from '@/lib/guards'

/**
 * The flat call list inside an activity block. Even calls from one family
 * stay at their original positions; artifacts use a separate transcript slot.
 */
export function ToolGroups({
  groups,
  live = false,
  conversationId,
}: {
  groups: readonly ToolGroupView[]
  /**
   * This activity is live. Historical unanswered calls read as pending.
   */
  live?: boolean
  /** The conversation the calls ran in, which keys their attachments. */
  conversationId: string
}) {
  const calls = groups.flatMap((group) => group.calls)
  const rows: ({ readonly kind: 'images'; readonly id: string; readonly images: ReadImage[] } |
    { readonly kind: 'call'; readonly id: string; readonly call: ToolCallView })[] = []
  for (const call of calls) {
    if (toolPresentation(call.toolName).activity === 'none') continue
    const images = readImages(call)
    const previous = rows[rows.length - 1]
    if (images.length === 0) rows.push({ kind: 'call', id: call.toolCallId, call })
    else if (previous?.kind === 'images') previous.images.push(...images)
    else rows.push({ kind: 'images', id: call.toolCallId, images: [...images] })
  }
  return (
    <div className="my-1 flex min-w-0 flex-col gap-0.5">
      {rows.map((row) => row.kind === 'images'
        ? <ImageReads key={row.id} images={row.images} live={live} conversationId={conversationId} />
        : <CallRow key={row.id} call={row.call} live={live} conversationId={conversationId} />)}
    </div>
  )
}

/**
 * Activity opens onto compact rows. Full artifacts have their own placement
 * in the transcript, independent of whether this disclosure is open.
 */
function CallRow({ call, live, conversationId }: { call: ToolCallView; live: boolean; conversationId: string }) {
  const family = familyOf(call.toolName)
  const presentation = toolPresentation(call.toolName)
  if (presentation.activity === 'steps' && family !== null) return <BrowserReport calls={[call]} live={live} conversationId={conversationId} family={family} presentation="activity" />
  if (presentation.activity === 'compact-research') return <ResearchRow call={call} live={live} />
  return <ToolCallRow call={call} live={live} />
}

const RESEARCH_PREVIEW_LIMIT = 3

function ResearchRow({ call, live }: { call: ToolCallView; live: boolean }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const step = readWebCall(call)
  if (step === null) return null
  const state = resultState(call, live)
  const failed = state === 'failed'
  const pending = state === 'pending' || state === 'running'
  const searching = step.kind === 'search'
  const verb = failed ? searching ? 'Search failed' : 'Could not read' : searching
    ? pending ? 'Searching' : 'Searched' : pending ? 'Reading' : 'Read'
  const subject = searching ? step.query : step.title ?? step.url
  const sources = searching ? step.hits : /^https?:\/\//i.test(step.url)
    ? [{ title: step.title ?? hostOf(step.url), url: step.url }]
    : []
  const extra = sources.length - RESEARCH_PREVIEW_LIMIT
  return <DisclosureRow leading={searching ? <Icons.search /> : <Icons.browserUse />} entering={live} open={open}
    onToggle={() => setOpen((value) => !value)} chevron="hover" flush
    label={<>
      <span className={cn('min-w-0 truncate', failed && 'text-danger', state === 'running' && 'studio-shimmer')}>{verb} {subject} {state === 'pending' ? 'pending' : null}</span>
      {searching && state === 'success' && sources.length > 0
        ? <span className="shrink-0">· {sources.length} {sources.length === 1 ? 'source' : 'sources'}</span>
        : null}
    </>}>
    <ToolResultPanel title={searching ? 'Web search' : 'Web fetch'} call={call} live={live} scroll={false}>
      {state === 'success' && sources.length === 0 ? (
        <p className="text-muted-foreground">{searching ? 'No results.' : 'No page link recorded.'}</p>
      ) : null}
      {state === 'success' && sources.length > 0 ? <div>
        <table className="w-full table-fixed text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="pb-1 font-medium">{searching ? 'Source' : 'Page'}</th>
              <th scope="col" className="w-1/3 pb-1 pl-3 font-medium">Site</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(showAll ? sources : sources.slice(0, RESEARCH_PREVIEW_LIMIT)).map((source, index) => (
              <tr key={`${source.url}:${String(index)}`}>
                <td className="py-1.5">
                  <a href={source.url} target="_blank" rel="noreferrer noopener"
                    className="block truncate hover:underline" title={source.title}>{source.title}</a>
                </td>
                <td className="py-1.5 pl-3 text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-2">
                    <SiteMark href={source.url} />
                    <span className="min-w-0 truncate" title={hostOf(source.url)}>{hostOf(source.url)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {extra > 0 ? <ShowMoreButton expanded={showAll} onToggle={() => setShowAll((value) => !value)}
          moreLabel={`Show ${String(extra)} more`} className="mt-2" /> : null}
      </div> : null}
    </ToolResultPanel>
  </DisclosureRow>
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
  plan: { mark: Icons.plan, running: 'Planning', done: 'Planned' },
  ask_user_question: { mark: Icons.ask, running: 'Asking', done: 'Asked' },
  // The folder question wears the same mark: it is a question to the
  // person, and the row's subject is the folder the model asked for.
  request_folder: { mark: Icons.ask, running: 'Asking for', done: 'Asked for' },
  // Discovery wears MCP's own mark rather than a magnifying glass: what it
  // searches is the extensions, and the mark the settings pane already uses
  // for them is the one a reader has been taught. Its verbs say what the
  // model did, which is look something up - the loading it also does is a
  // change to the next step's tools, and a row in the transcript is the
  // wrong place to announce that.
  discover: { mark: Icons.mcp, running: 'Discovering', done: 'Discovered' },
  jobs: { mark: Icons.backgroundJobs, running: 'Checking', done: 'Checked' },
  // Delegation is its own kind of call: the work does not happen here but in
  // the named delegate's own session, and the only thing that crosses back
  // is its final message. The chip's subject is the agent the model chose -
  // the one fact of the call a person can act on - and the branch mark says
  // the work forked, which is what the verb would otherwise have to carry.
  task: { mark: Icons.branch, running: 'Delegating to', done: 'Delegated to' },
  delete: { mark: Icons.delete, running: 'Deleting', done: 'Deleted' },
  move: { mark: Icons.move, running: 'Moving', done: 'Moved' },
  // The library tools wear the library's own mark, not the search glass:
  // glob and grep search the project, and these search -- or add to -- the
  // library, which is the thing the settings pane already taught the reader
  // to recognise by that grid of tiles.
  library_search: { mark: Icons.library, running: 'Searching', done: 'Searched' },
  library_keep: { mark: Icons.keep, running: 'Keeping', done: 'Kept' },
  // OCR reads a page through a provider; the row's subject is the file,
  // and the verb is the reading it is, not the network trip it takes.
  ocr: { mark: Icons.fileRead, running: 'Reading pages of', done: 'Read pages of' },
  activate_skill: { mark: Icons.skill, running: 'Activating', done: 'Activated' },
  read_skill_resource: { mark: Icons.fileRead, running: 'Reading skill resource', done: 'Read skill resource' },
  voice_work: { mark: Icons.voice, running: 'Managing voice work', done: 'Managed voice work' },
  task_activity: { mark: Icons.backgroundJobs, running: 'Checking task activity', done: 'Checked task activity' },
}

function actionOf(toolName: string): ToolAction {
  return ACTIONS[toolName.replace(/^native_/, '')] ?? {
    mark: toolName.startsWith('mcp__') ? Icons.mcp : Icons.tools,
    running: readableName(toolName), done: readableName(toolName),
  }
}

/** The tools whose subject is a file path, and so earns the file's own mark. */
const FILE_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'ocr'])

function answeredOf(call: ToolCallView): boolean {
  return call.output !== null && call.output.present
}

export function activityLabel(call: ToolCallView): string {
  const verb = actionOf(call.toolName).running
  const subject = subjectOf(call)
  return subject === null ? verb : `${verb} ${subject}`
}

/* -------------------------------------------------------------------------- */
/* The single call                                                             */
/* -------------------------------------------------------------------------- */

function ToolCallRow({ call, live }: { call: ToolCallView; live: boolean }) {
  const [open, setOpen] = useState(false)
  const action = actionOf(call.toolName)
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
  const searched = searchOutcomeOf(call)
  const operation = fileOperationOf(call)
  // A search names its aim from its input whether the answer has arrived or
  // not: the query line stands in for the raw input slab while the call runs,
  // and beside the raw answer when the answer fell back to raw.
  const searchQuery = searched === null ? searchQueryOf(call) : null
  const running = call.errorText === null && !answered
  const failed = resultState(call, live) === 'failed'
  const verb =
    operation !== null && failed
      ? call.toolName === 'move' ? 'Could not move' : 'Could not delete'
      : running ? action.running : action.done

  // A text read is a statement, not a disclosure. Its answer is the page the
  // model read -- the model's business, and a slab a reader was never meant
  // to wade through -- and everything the chip could say about it, the verb
  // and the file, it already says. So a read that came back intact opens
  // onto nothing and carries no chevron promising an opening. The exception
  // is failure: the error is the one part of a text read's answer a person
  // may need. Image results have already been routed to ImageReads above.
  if (call.toolName === 'read' && call.errorText === null) {
    return (
      <DisclosureRow
        leading={<action.mark />}
        entering={live}
        label={
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'shrink-0',
                running && live && 'studio-shimmer inline-block whitespace-nowrap',
              )}
            >
              {verb}
            </span>
            {file !== null ? <FileTypeMark path={file} /> : null}
            {file !== null ? <FileSubject path={file} /> : null}
            {running && !live ? (
              <span className="shrink-0 opacity-60">pending</span>
            ) : null}
          </span>
        }
        open={false}
        onToggle={() => {}}
        disabled
      />
    )
  }

  return (
    <DisclosureRow
      leading={<action.mark />}
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
          {failed ? (
            <span className="shrink-0 text-danger">Failed</span>
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
      flush
    >
      {operation !== null ? (
        <FileOperation call={call} view={operation} live={live} />
      ) : (
        <CallWorkingOut
          call={call}
          diff={diff}
          file={file}
          outcome={outcome}
          searched={searched}
          searchQuery={searchQuery}
          live={live}
        />
      )}
    </DisclosureRow>
  )
}

/**
 * What opens under a chip: the call's working-out, in the shape its own kind
 * names. A file-writing call shows the diff it described and the harness's
 * own sentence; a question call shows each question and the exact answer
 * it was given; a search shows its answer as a result list -- the files,
 * the lines, the matched words -- and its aim as one line while the answer
 * is still out; other tools use dedicated reports or readable field lists.
 * A read lands here only when it failed -- the error
 * is its working-out -- because an answered read is a statement, not a
 * disclosure.
 */
function CallWorkingOut({
  call,
  diff,
  file,
  outcome,
  searched,
  searchQuery,
  live,
}: {
  call: ToolCallView
  diff: LineDiff | null
  file: string | null
  outcome: FileToolOutcome | null
  searched: SearchOutcome | null
  searchQuery: SearchQuery | null
  live: boolean
}) {
  const diffed = diff !== null && file !== null
  if (!diffed && searched === null && call.toolName !== 'ask_user_question') {
    if (call.toolName === 'shell' || call.toolName === 'git') return <ShellDetails call={call} live={live} />
    if (call.toolName === 'plan') return <PlanDetails call={call} live={live} />
    if (call.toolName === 'discover') return <DiscoveryDetails call={call} live={live} />
    if (call.toolName === 'task') return <AgentTaskDetails call={call} live={live} />
    if (call.toolName === 'jobs') return <JobsDetails call={call} live={live} />
    if (call.toolName === 'library_search' || call.toolName === 'library_keep') return <LibraryDetails call={call} live={live} />
    if (call.toolName.startsWith('mcp__')) return <ExtensionToolDetails call={call} live={live} />
    return <GenericToolDetails call={call} live={live}
      request={searchQuery !== null ? <SearchQueryLine query={searchQuery} /> : undefined} />
  }
  return (
    <div className="flex flex-col gap-1">
      {searched !== null ? (
        <SearchResults outcome={searched} />
      ) : diffed ? (
        <FileDiff path={file} diff={diff} />
      ) : call.toolName === 'ask_user_question' ? (
        <AskWorkingOut call={call} />
      ) : null}
      {call.errorText !== null ? (
        <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-code text-danger">
          {call.errorText}
        </pre>
      ) : call.output !== null && call.output.present ? (
        // A parsed search said everything on the list: the sentence for an
        // empty one, the files and lines otherwise. Nothing stands under it.
        searched !== null ? null : diffed && outcome !== null ? (
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
        ) : call.toolName !== 'ask_user_question' ? <StructuredValue value={call.output.value} /> : null
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
          <span className="text-caption text-muted-foreground">
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
 * The call's parsed search answer, or null. Null for anything but a grep or
 * glob, for an answer that is not the harness's prose, and for prose the
 * parser cannot read -- all of which keep today's raw rendering.
 */
function searchOutcomeOf(call: ToolCallView): SearchOutcome | null {
  if (call.output === null || !call.output.present) return null
  const value: unknown = call.output.value
  if (typeof value !== 'string') return null
  const input: unknown = call.input !== null && call.input.present ? call.input.value : null
  return parseSearchOutcome(call.toolName, input, value)
}

/** The call's aim, for a search -- null for anything else or a patternless input. */
function searchQueryOf(call: ToolCallView): SearchQuery | null {
  if (call.input === null || !call.input.present) return null
  return parseSearchQuery(call.toolName, call.input.value)
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
  if (call.toolName.replace(/^native_/, '') === 'activate_skill') return firstString(input, ['name'])
  // `from` first for a move: the row's object is the file that exists, and
  // the destination it gained is the call's working-out, not its subject.
  // `agent` for a task call: the delegate's name is the row's subject.
  for (const key of ['path', 'file_path', 'from', 'command', 'pattern', 'query', 'url', 'agent']) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function askSubject(input: Record<string, unknown>): string | null {
  const questions = input['questions']
  if (!Array.isArray(questions) || questions.length === 0) return null
  // `Array.isArray` narrows an unknown to `any[]`, so the element is named
  // as unknown before `isRecord` is asked about it.
  const first: unknown = questions[0]
  if (!isRecord(first)) return null
  const header = first['header']
  if (typeof header !== 'string' || header.length === 0) return null
  return questions.length > 1 ? `${header} +${questions.length - 1}` : header
}
