/**
 * The UI transcript, reduced from chunk facts.
 *
 * What the model receives and what renders here are two projections of the
 * same event log, and neither is derived from the other (transcript-and-
 * rendering.md section 1). This module owns the UI side. It consumes what
 * `useConversation` forwards — history snapshots and update chunks — and
 * produces the ordered items a person reads. Nothing here ever flows back up
 * into a request.
 *
 * ---- Grouping is structural, never inferred -------------------------------
 *
 * The unit is ONE ASSISTANT MESSAGE'S tool calls, arranged into rows: a row
 * per maximal same-file run of mutating calls, a row per call otherwise --
 * both halves are facts already in the log (the message id, the tool name,
 * and the path in the call's own input). No semantic labels exist here and
 * none may be added: a label the model did not emit is a guess wearing a
 * fact's clothes. A run's row renders once and mutates as its calls arrive,
 * which is why the row's id is derived, not minted -- a replay's walk must
 * build the same ids the live turn grew.
 *
 * ---- Thinking blocks are segments, not a mutable block --------------------
 *
 * Reasoning deltas accumulate into per-segment blocks positioned where they
 * occurred, keyed by message id and ordinal — because we reattach at an
 * offset, and a single global block has no stable identity across a replay.
 *
 * ---- Idempotent under replay ----------------------------------------------
 *
 * Every chunk carries a monotonic position; anything at or before the last
 * applied position is dropped, so a redelivered batch (an SSE reconnect
 * replays the batch that was in flight) applies exactly once. The same
 * discipline Task 24 established for turn state, extended to content rather
 * than reimplemented beside it.
 *
 * ---- An interrupted turn is never a finished one --------------------------
 *
 * A message is complete only when `message-completed` says so (or the
 * snapshot's own part states do); a submission is finished only when a
 * settlement says so. Silence proves nothing — a stream that stops
 * mid-sentence leaves a visibly unfinished message behind, whatever the
 * connection does afterwards.
 *
 * ---- A failed submission must not look like a completed one ---------------
 *
 * `message-completed` means "this attempt's record is closed", not "this
 * turn succeeded". Each retry attempt of a failing turn closes its own
 * record cleanly — so by the time the settlement arrives, four empty
 * attempts all read complete, and a rule that only touches still-open
 * messages correctly changes nothing. The rule here:
 *
 *  - an OPEN message of the failed submission takes the outcome, with the
 *    settlement's sentence beside it when the wire carried one;
 *  - a message that closed WITHOUT EVER PRODUCING CONTENT is withdrawn —
 *    it was a retry attempt that never got to speak, and four empty bubbles
 *    are a fabricated success however they are labelled;
 *  - a message that closed WITH content keeps its completion — a late
 *    failure never retroactively falsifies real work;
 *  - if withdrawal leaves nothing of the submission standing, one failure
 *    item takes the attempts' place, carrying the provider's sentence.
 *
 * Everything here is derivable from wire facts alone: content means a delta
 * or a tool input arrived for that message id. No counting, no emptiness
 * test over text — and a legitimately silent model is never misrepresented,
 * because silence under a COMPLETED settlement touches nothing at all.
 */

import type {
  ChunkFacts,
  ChunkPosition,
  ConversationMessageFacts,
  ConversationSnapshotFacts,
  ModelRefFacts,
  Present,
  UsageFacts,
} from '@/platform/harness'

/* -------------------------------------------------------------------------- */
/* Renderable shapes                                                           */
/* -------------------------------------------------------------------------- */

/** One tool call, as a collapsed group expands to show it. */
export interface ToolCallView {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: Present<unknown> | null
  /** The answer, when it arrived. A call whose answer never arrives stays pending. */
  readonly output: Present<unknown> | null
  readonly errorText: string | null
}

/**
 * One rendered row of a tools segment.
 *
 * A row is either a RUN -- a maximal line of consecutive, file-mutating calls
 * against the same file, the unit a reader watches tick while the model
 * churns on one file -- or a single call standing alone. Read-only calls
 * never join a run and never break one (the retry pattern re-reads the file
 * mid-edit; one flaky edit must not fragment into three rows), but they do
 * stand between runs as rows of their own, so the wire's order stays
 * readable. A mutating call against a different file closes the run it
 * follows, and nothing merges across it -- the interruption happened, and
 * chronology is the value of the event log. A run for one file can therefore
 * appear several times in one segment, and that is correct.
 *
 * Grouping is per segment, and a segment is per message: text written
 * between tool calls starts a new segment, which starts fresh rows -- the
 * same rule the flat chips lived under.
 */
export interface ToolGroupView {
  /** Stable within the segment; a replay's walk produces the same ids. */
  readonly id: string
  readonly calls: readonly ToolCallView[]
  /** The run's file, when this row is a same-file mutating run. */
  readonly file: string | null
}

/** The tools whose effect is mutating the file their path names. */
const FILE_MUTATING: ReadonlySet<string> = new Set(['edit', 'write'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The path a mutating call acts on, or null -- read by field name, never guessed. */
function fileOf(toolName: string, input: Present<unknown> | null): string | null {
  if (!FILE_MUTATING.has(toolName)) return null
  return pathFrom(input)
}

/** The path a read names, or null -- the other half of the transparency question. */
function readPathOf(toolName: string, input: Present<unknown> | null): string | null {
  if (toolName !== 'read') return null
  return pathFrom(input)
}

function pathFrom(input: Present<unknown> | null): string | null {
  if (input === null || !input.present) return null
  const value: unknown = input.value
  if (!isRecord(value)) return null
  for (const key of ['path', 'file_path']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

/**
 * Opens a new row for one call in a segment's list. Merging is not this
 * function's business any more: a call that continues a run merges into the
 * row the run's own memory points at, wherever that row sits; a call that
 * breaks one starts here, at the end of the story.
 */
function pushCall(
  rows: readonly ToolGroupView[],
  segmentId: string,
  call: ToolCallView,
): { readonly rows: readonly ToolGroupView[]; readonly row: number; readonly call: number } {
  const row: ToolGroupView = {
    id: `${segmentId}#row-${rows.length}`,
    calls: [call],
    file: fileOf(call.toolName, call.input),
  }
  return { rows: [...rows, row], row: rows.length, call: 0 }
}

export type AssistantSegment =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'thinking'
      readonly id: string
      readonly text: string
      /**
       * When this run's first delta ARRIVED HERE, and when its most recent one
       * did. Both null for anything replayed.
       *
       * The wire carries no per-segment duration — Flue's chunk protocol has
       * one timestamp, on `message-started` — so the only honest number
       * available is the span over which this run's deltas actually landed.
       * That is a measurement of something that happened, not an inference
       * about the model, and it is the difference between saying "these words
       * arrived over four seconds" and inventing a thinking time nobody
       * reported.
       *
       * It is null on a replay because a replay's arrival times are the
       * REPLAY's, not the turn's: a reattach that redelivers a two-minute
       * trace in fifty milliseconds would otherwise claim the model thought
       * for fifty milliseconds. `useConversationTranscript` gates it on the
       * delivery's own `replaying` flag, and a segment with no span says only
       * "Thought", which is what we actually know.
       */
      readonly startedAt: number | null
      readonly updatedAt: number | null
    }
  | { readonly kind: 'tools'; readonly id: string; readonly groups: readonly ToolGroupView[] }

/** How a message ended, as far as the log can prove. */
export type MessageEnd =
  | { readonly state: 'complete' }
  | { readonly state: 'stopped' }
  /**
   * The submission settled failed/aborted over this record. `reason` is the
   * settlement's own sentence — the provider's words, or null when the wire
   * carried none. Never invented here; "unknown" renders as unknown.
   */
  | { readonly state: 'failed'; readonly reason: string | null }
  | { readonly state: 'aborted'; readonly reason: string | null }

export interface UserAttachmentView {
  readonly mediaType: string
  readonly filename: string | null
  readonly size: number | null
}

export type TranscriptItem =
  | {
      readonly kind: 'user'
      readonly id: string
      /** The submission these words opened, when one carried them. */
      readonly submissionId: string | null
      readonly text: string
      readonly attachments: readonly UserAttachmentView[]
      readonly timestamp: string | null
    }
  | {
      readonly kind: 'assistant'
      readonly id: string
      readonly submissionId: string | null
      readonly model: ModelRefFacts | null
      readonly segments: readonly AssistantSegment[]
      /** How this message ended. Never inferred from silence. */
      readonly end: MessageEnd
      readonly usage: UsageFacts | null
    }
  | {
      /**
       * A failed or aborted submission standing where its contentless retry
       * attempts stood. Exists so a rate-limited turn reads as ONE visible
       * failure instead of four empty bubbles — the display projection
       * collapsing records that carry nothing of their own. What the
       * attempts said (nothing) and what the settlement said (the failure)
       * are both still in the log; this is the honest rendering of them.
       */
      readonly kind: 'submission-failed'
      /** Stable per submission, so identity survives a replay. */
      readonly id: string
      readonly submissionId: string
      readonly outcome: 'failed' | 'aborted'
      /** The settlement's own sentence; null when none arrived. */
      readonly reason: string | null
    }

/**
 * Where the next delta of each kind would attach, per message. Bookkeeping,
 * not content: it exists so a delta extends the segment the previous delta
 * opened, across however many deliveries that takes.
 */
interface OpenRun {
  readonly kind: 'text' | 'thinking'
  readonly index: number
}

/** Where one tool call lives, so its answer can find it from a later batch. */
interface CallSite {
  readonly itemIndex: number
  readonly segmentIndex: number
  readonly groupIndex: number
  readonly callIndex: number
}

/**
 * Words this window sent, which the log has not echoed back yet.
 *
 * A user's own message reaches the transcript the same way everything else
 * does: the harness durably records it and a `message-appended` chunk brings
 * it back. That round trip is a real interval — measured at roughly a second
 * on this machine — and for its whole length the page showed no sign of the
 * message that had just been typed into it. The words vanished from the
 * composer and appeared nowhere, and the working mark sat alone against an
 * empty page and then JUMPED down when the echo finally landed above it.
 *
 * This is not an invented log entry and it is not held in `items`, which are
 * facts the harness reported. It is the receipt rendered: we hold a
 * submission id the harness answered with, and until its own message comes
 * back, the words that id stands for are shown where they will land. The id
 * is what retires it — not a timer, and not the arrival of any other message.
 */
export interface PendingSubmission {
  /** The submission the harness admitted. Its echo is what clears this. */
  readonly submissionId: string
  readonly text: string
  /**
   * When this window was handed the receipt — the earliest moment anything on
   * this side knew a turn existed, earlier than any chunk about it can
   * arrive. Nothing measures a duration from it, and nothing orders by it
   * either — a held submission is always the newest thing there is, which is
   * why it draws below every item without consulting a clock. What the screen
   * reports about time is the reasoning run's own span, and the wait in front
   * of that is drawn by nothing. See `first-attach.ts` for why it is kept.
   */
  readonly at: number
}

export interface TranscriptProjection {
  readonly items: readonly TranscriptItem[]
  /** The ordering token everything above was built from. */
  readonly applied: ChunkPosition | null
  readonly openRuns: ReadonlyMap<string, OpenRun>
  readonly callSites: ReadonlyMap<string, CallSite>
  /**
   * The file run a message still has open: where its row lives and what file
   * it holds. This is the walk's own memory, not rendering state -- a run
   * stays open across written narration and a re-read of its own file, and
   * closes the moment anything else happens.
   */
  readonly openFileRuns: ReadonlyMap<string, OpenFileRun>
  /** Sent, not yet echoed. Always newer than every item; see the type. */
  readonly pending: PendingSubmission | null
}

/** Where a message's open file run lives, and what it is a run of. */
export interface OpenFileRun {
  readonly segmentIndex: number
  readonly groupIndex: number
  readonly file: string
}

/* -------------------------------------------------------------------------- */
/* Internal draft                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The mutable working shape behind an immutable `TranscriptProjection`.
 * Functions below clone shallowly, apply a whole batch, and hand back a new
 * immutable projection — React sees fresh objects, nothing downstream can
 * observe a half-applied batch.
 */
interface Draft {
  items: TranscriptItem[]
  applied: ChunkPosition | null
  /** Assistant item index by message id. */
  assistants: Map<string, number>
  openRuns: Map<string, OpenRun>
  openFileRuns: Map<string, OpenFileRun>
  callSites: Map<string, CallSite>
  pending: PendingSubmission | null
}

function draftOf(projection: TranscriptProjection): Draft {
  return {
    items: [...projection.items],
    applied: projection.applied,
    assistants: assistantsOf(projection.items),
    openRuns: new Map(projection.openRuns),
    openFileRuns: new Map(projection.openFileRuns),
    callSites: new Map(projection.callSites),
    pending: projection.pending,
  }
}

/**
 * Whether the log now carries the message a pending submission stands for.
 *
 * Backwards, because an echo lands at the end and this only ever runs while
 * something is in flight — a window of about a second, during which the
 * answer is almost always the last item. The scan is bounded by the array
 * only in the case where the echo never comes, and then the projection is
 * right to keep looking: the alternative is retiring the words on a guess.
 */
function echoed(items: readonly TranscriptItem[], pending: PendingSubmission): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item === undefined) continue
    if (item.kind === 'user' && item.submissionId === pending.submissionId) return true
  }
  return false
}

function settle(draft: Draft): TranscriptProjection {
  // The one place a pending submission is retired. Every path that changes
  // items comes through here, including a snapshot that replaced them all,
  // so there is no arrangement of deliveries that leaves the words on screen
  // twice or drops them before the log has them.
  const pending =
    draft.pending !== null && echoed(draft.items, draft.pending) ? null : draft.pending
  return {
    items: draft.items,
    applied: draft.applied,
    openRuns: draft.openRuns,
    openFileRuns: draft.openFileRuns,
    callSites: draft.callSites,
    pending,
  }
}

/** Lexicographic chunk order: by batch, then index. */
function atOrBefore(a: ChunkPosition, b: ChunkPosition): boolean {
  return a.batch < b.batch || (a.batch === b.batch && a.index <= b.index)
}

/* -------------------------------------------------------------------------- */
/* Segment construction                                                        */
/* -------------------------------------------------------------------------- */

function emptyAssistant(message: ConversationMessageFacts): Extract<
  TranscriptItem,
  { kind: 'assistant' }
> {
  return {
    kind: 'assistant',
    id: message.id,
    submissionId: message.submissionId,
    model: message.model,
    segments: [],
    end: { state: 'stopped' },
    usage: message.usage,
  }
}

/**
 * The assistant item a message id names, with the index it sits at.
 *
 * The index comes back beside the item because every caller writes the item
 * back afterwards and needs the place to put it. It used to be looked up a
 * second time at each write, under `?? -1` -- a fallback that could never be
 * reached, since the item had already been found through the same map, but
 * one that would have written a property named `-1` onto the array rather
 * than failing if it ever were. Resolved once, there is nothing left to
 * default.
 */
function assistantAt(
  draft: Draft,
  messageId: string,
): { readonly index: number; readonly item: Extract<TranscriptItem, { kind: 'assistant' }> } | null {
  const index = draft.assistants.get(messageId)
  if (index === undefined) return null
  const item = draft.items[index]
  return item !== undefined && item.kind === 'assistant' ? { index, item } : null
}

/**
 * Appends one delta to the message's open run of that kind, opening a new run
 * if needed.
 *
 * `arrivedAt` is when this batch reached the webview, or null when it was
 * replayed. It is stamped on thinking runs only, and only here: the span a
 * run's deltas landed over needs no close hook anywhere, because the last
 * delta to arrive is the last one that will, and the reader wants the number
 * while it is still growing rather than after it stops.
 */
function appendDelta(
  draft: Draft,
  messageId: string,
  kind: 'text' | 'thinking',
  text: string,
  arrivedAt: number | null,
): void {
  const found = assistantAt(draft, messageId)
  if (found === null) return
  const { index: itemIndex, item } = found

  // Written narration keeps a file run open -- the words describe the events
  // around them, and "Edit 2 of 4" must not orphan "Edit 1 of 4". Thinking is
  // the opposite kind of sentence: work the model went away and did, and the
  // events on either side of it happened apart.
  if (kind === 'thinking') draft.openFileRuns.delete(messageId)

  const segments = [...item.segments]
  const open = draft.openRuns.get(messageId)
  if (open !== undefined && open.kind === kind) {
    const segment = segments[open.index]
    if (segment !== undefined && segment.kind === kind) {
      segments[open.index] =
        segment.kind === 'thinking'
          ? // A replayed delta landing on a live run leaves the span alone
            // rather than overwriting it with a replay's clock.
            {
              ...segment,
              text: segment.text + text,
              updatedAt: arrivedAt ?? segment.updatedAt,
            }
          : { ...segment, text: segment.text + text }
      draft.items[itemIndex] = { ...item, segments }
      return
    }
  }

  // A different kind is open, or none: this delta begins a new segment.
  draft.openRuns.delete(messageId)
  const ordinal = segments.filter((candidate) => candidate.kind === kind).length
  segments.push(
    kind === 'text'
      ? { kind: 'text', id: `${messageId}#text-${ordinal}`, text }
      : {
          kind: 'thinking',
          id: `${messageId}#think-${ordinal}`,
          text,
          startedAt: arrivedAt,
          updatedAt: arrivedAt,
        },
  )
  draft.openRuns.set(messageId, { kind, index: segments.length - 1 })
  draft.items[itemIndex] = { ...item, segments }
}

/**
 * Adds one tool call at its place in the message's story.
 *
 * The shape of the rule, in order: a mutating call that continues the
 * message's open file run joins that run's row, wherever the row sits --
 * written narration may have landed since, and it renders after the events
 * it describes. Anything else -- a different file, a search, a read of some
 * other file, the model going away to think -- closed the run on arrival,
 * and this call takes a new row at the end of the story. A read of the run's
 * own file is the one tool that closes nothing: the verify-then-fix loop is
 * one act, and its row stands between the calls it sits between.
 */
function appendToolCall(
  draft: Draft,
  messageId: string,
  toolCallId: string,
  toolName: string,
  input: Present<unknown> | null,
): void {
  const found = assistantAt(draft, messageId)
  if (found === null) return
  const { index: itemIndex, item } = found

  draft.openRuns.delete(messageId)

  const open = draft.openFileRuns.get(messageId) ?? null
  const file = fileOf(toolName, input)

  // Continue the open run, across whatever narration landed on top of it.
  if (file !== null && open !== null && file === open.file) {
    const home = item.segments[open.segmentIndex]
    if (home !== undefined && home.kind === 'tools') {
      const group = home.groups[open.groupIndex]
      if (group !== undefined) {
        const merged: ToolGroupView = {
          ...group,
          calls: [...group.calls, { toolCallId, toolName, input, output: null, errorText: null }],
        }
        const groups = [...home.groups]
        groups[open.groupIndex] = merged
        const segments = [...item.segments]
        segments[open.segmentIndex] = { ...home, groups }
        draft.items[itemIndex] = { ...item, segments }
        draft.callSites.set(toolCallId, {
          itemIndex,
          segmentIndex: open.segmentIndex,
          groupIndex: open.groupIndex,
          callIndex: merged.calls.length - 1,
        })
        return
      }
    }
  }

  // A non-mutating call keeps the run only when it is a read of the run's
  // own file; anything else that happened closed it before this row opened.
  if (file === null) {
    const path = readPathOf(toolName, input)
    const transparent = open !== null && path !== null && path === open.file
    if (!transparent) draft.openFileRuns.delete(messageId)
  } else {
    draft.openFileRuns.delete(messageId)
  }

  const segments = [...item.segments]
  let segmentIndex = segments.length - 1
  let segment = segments[segmentIndex]
  if (segment === undefined || segment.kind !== 'tools') {
    segment = { kind: 'tools', id: `${messageId}#tools-${segments.length}`, groups: [] }
    segments.push(segment)
    segmentIndex = segments.length - 1
  }

  const pushed = pushCall(segment.groups, segment.id, {
    toolCallId,
    toolName,
    input,
    output: null,
    errorText: null,
  })
  segments[segmentIndex] = { ...segment, groups: pushed.rows }
  draft.items[itemIndex] = { ...item, segments }
  draft.callSites.set(toolCallId, {
    itemIndex,
    segmentIndex,
    groupIndex: pushed.row,
    callIndex: pushed.call,
  })

  const opened = pushed.rows[pushed.row]
  if (opened !== undefined && opened.file !== null) {
    draft.openFileRuns.set(messageId, {
      segmentIndex,
      groupIndex: pushed.row,
      file: opened.file,
    })
  }
}

/** Delivers an answer to the call it belongs to, wherever that call landed. */
function answerToolCall(
  draft: Draft,
  toolCallId: string,
  answer: { output?: Present<unknown> | null; errorText?: string | null },
): void {
  const site = draft.callSites.get(toolCallId)
  if (site === undefined) return
  const item = draft.items[site.itemIndex]
  if (item === undefined || item.kind !== 'assistant') return
  const segment = item.segments[site.segmentIndex]
  if (segment === undefined || segment.kind !== 'tools') return
  const group = segment.groups[site.groupIndex]
  if (group === undefined) return
  const call = group.calls[site.callIndex]
  if (call === undefined) return

  const updated: ToolCallView = {
    ...call,
    ...(answer.output !== undefined ? { output: answer.output } : {}),
    ...(answer.errorText !== undefined ? { errorText: answer.errorText } : {}),
  }
  const calls = [...group.calls]
  calls[site.callIndex] = updated
  const groups = [...segment.groups]
  groups[site.groupIndex] = { ...group, calls }
  const segments = [...item.segments]
  segments[site.segmentIndex] = { ...segment, groups }
  draft.items[site.itemIndex] = { ...item, segments }
}

type AssistantItem = Extract<TranscriptItem, { kind: 'assistant' }>

/** Which items a failed or aborted submission owns, position included. */
type BelongsTo = (item: AssistantItem, index: number) => boolean

/**
 * Applies one failed or aborted settlement to a list of items, in place.
 * The rule is the module docblock's: open messages take the outcome (with
 * the sentence beside it), closed-without-content attempts are withdrawn,
 * closed-with-content messages keep their completion, and a submission left
 * with nothing standing gets one failure item where its attempts were.
 *
 * Returns whether anything changed. `items` is mutated; callers that keep
 * id-indexed maps rebuild them when this returns true — withdrawal and
 * insertion shift every index after the first one touched.
 */
function settleSubmissionFailure(
  items: TranscriptItem[],
  submissionId: string,
  belongsTo: BelongsTo,
  outcome: 'failed' | 'aborted',
  reason: string | null,
): boolean {
  const withdrawn = new Set<number>()
  let survivors = 0
  // The first withdrawn attempt's index. Nothing before it is removed, so
  // this is also where a replacement failure item goes if nothing survives.
  let firstWithdrawn = -1

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item === undefined || item.kind !== 'assistant' || !belongsTo(item, index)) continue
    if (item.end.state === 'complete') {
      if (item.segments.length === 0) {
        if (firstWithdrawn === -1) firstWithdrawn = index
        withdrawn.add(index)
        continue
      }
      survivors += 1
      continue
    }
    // An open record takes the outcome: interrupted means interrupted, at
    // the transcript layer too. A crash-recovered stopped message under an
    // abort or failure must not read as an ordinary pause.
    items[index] = { ...item, end: { state: outcome, reason } }
    survivors += 1
  }

  if (withdrawn.size === 0) return false

  const kept: TranscriptItem[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item !== undefined && !withdrawn.has(index)) kept.push(item)
  }
  if (survivors === 0 && firstWithdrawn >= 0) {
    const card: TranscriptItem = {
      kind: 'submission-failed',
      id: `${submissionId}#settled`,
      submissionId,
      outcome,
      reason,
    }
    kept.splice(firstWithdrawn, 0, card)
  }
  items.length = 0
  for (const item of kept) items.push(item)
  return true
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

function assistantsOf(items: readonly TranscriptItem[]): Map<string, number> {
  const indexes = new Map<string, number>()
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item.kind === 'assistant') indexes.set(item.id, index)
  }
  return indexes
}

function callSitesOf(items: readonly TranscriptItem[]): Map<string, CallSite> {
  const sites = new Map<string, CallSite>()
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]
    if (item.kind !== 'assistant') continue
    for (let segmentIndex = 0; segmentIndex < item.segments.length; segmentIndex += 1) {
      const segment = item.segments[segmentIndex]
      if (segment.kind !== 'tools') continue
      for (let groupIndex = 0; groupIndex < segment.groups.length; groupIndex += 1) {
        const group = segment.groups[groupIndex]
        for (let callIndex = 0; callIndex < group.calls.length; callIndex += 1) {
          sites.set(group.calls[callIndex].toolCallId, {
            itemIndex,
            segmentIndex,
            groupIndex,
            callIndex,
          })
        }
      }
    }
  }
  return sites
}

/**
 * Builds items from a whole materialized conversation — the history view's
 * answer, or a reset chunk's identical payload. Replaces everything: a
 * snapshot IS the state, not a patch on it.
 *
 * Consecutive parts of a kind share a segment, so the shape a live turn
 * grew into is the shape a snapshot replays into. A message is complete
 * only when none of its parts says `streaming`; a call whose part never got
 * past `input-available` stays visibly pending.
 */
export function seededFrom(snapshot: ConversationSnapshotFacts): TranscriptItem[] {
  const items: TranscriptItem[] = []

  for (const message of snapshot.messages) {
    // 2.0 records runtime advisories (an aborted or interrupted submission's
    // terminal marker, the recovery signals around a materialized partial
    // stream) as `system` messages. They are diagnostics, not chat: the
    // failure a person needs is already carried by the settlement below,
    // which renders as the `submission-failed` card. The reader accepts the
    // role only so a stop control press does not make the whole snapshot
    // unparseable; nothing system-shaped becomes a transcript item.
    if (message.role === 'system') continue
    if (message.role === 'user') {
      const texts: string[] = []
      const attachments: UserAttachmentView[] = []
      for (const part of message.parts) {
        if (part.kind === 'text') texts.push(part.text)
        else if (part.kind === 'file')
          attachments.push({ mediaType: part.mediaType, filename: part.filename, size: part.size })
      }
      items.push({
        kind: 'user',
        id: message.id,
        submissionId: message.submissionId,
        text: texts.join('\n\n'),
        attachments,
        timestamp: message.timestamp,
      })
      continue
    }

    const base = emptyAssistant(message)
    const segments: AssistantSegment[] = []
    let textRuns = 0
    let thinkingRuns = 0
    // The live walk's memory, mirrored part for part: the file run this
    // message still has open, and where its row lives.
    let openFileRun: { segmentIndex: number; groupIndex: number; file: string } | null = null

    for (const part of message.parts) {
      if (part.kind === 'text') {
        segments.push({
          kind: 'text',
          id: `${message.id}#text-${textRuns}`,
          text: part.text,
        })
        textRuns += 1
      } else if (part.kind === 'reasoning') {
        segments.push({
          kind: 'thinking',
          id: `${message.id}#think-${thinkingRuns}`,
          text: part.text,
          // A snapshot is history. Nobody here watched these words arrive,
          // and the wire stores no span for them, so none is claimed.
          startedAt: null,
          updatedAt: null,
        })
        thinkingRuns += 1
        // Thinking is the one sentence that closes a file run: the events on
        // either side of it happened apart, and the replay must say so.
        openFileRun = null
      } else if (part.kind === 'tool') {
        // The live walk's rules, mirrored exactly, so ids and shapes match a
        // replay to the character: a mutating call continues the open run
        // wherever its row sits -- written narration may have fallen since --
        // and a read of the run's own file keeps it; everything else closed
        // it on arrival and opens a row at the end of the story.
        const input = part.input ?? null
        const file = fileOf(part.toolName, input)
        if (file !== null && openFileRun !== null && file === openFileRun.file) {
          const home = segments[openFileRun.segmentIndex]
          if (home !== undefined && home.kind === 'tools') {
            const group = home.groups[openFileRun.groupIndex]
            if (group !== undefined) {
              const merged: ToolGroupView = {
                ...group,
                calls: [
                  ...group.calls,
                  {
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    input,
                    output: part.output ?? null,
                    errorText: part.errorText ?? null,
                  },
                ],
              }
              const groups = [...home.groups]
              groups[openFileRun.groupIndex] = merged
              segments[openFileRun.segmentIndex] = { ...home, groups }
              continue
            }
          }
        }
        if (file === null) {
          const path = readPathOf(part.toolName, input)
          const transparent = openFileRun !== null && path !== null && path === openFileRun.file
          if (!transparent) openFileRun = null
        } else {
          openFileRun = null
        }
        const last = segments[segments.length - 1]
        const existing = last !== undefined && last.kind === 'tools' ? last : undefined
        const segment =
          existing ??
          ({ kind: 'tools', id: `${message.id}#tools-${segments.length}`, groups: [] } as const)
        const pushed = pushCall(segment.groups, segment.id, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input,
          output: part.output ?? null,
          errorText: part.errorText ?? null,
        })
        const nextSegment = { ...segment, groups: pushed.rows }
        if (existing !== undefined) {
          segments[segments.length - 1] = nextSegment
        } else {
          segments.push(nextSegment)
        }
        const opened = pushed.rows[pushed.row]
        if (opened !== undefined && opened.file !== null) {
          openFileRun = {
            segmentIndex: segments.length - 1,
            groupIndex: pushed.row,
            file: opened.file,
          }
        }
      }
    }

    const stillWriting = message.parts.some(
      (part) =>
        (part.kind === 'text' || part.kind === 'reasoning') && part.state === 'streaming',
    )
    items.push({
      ...base,
      segments,
      end: stillWriting ? { state: 'stopped' } : { state: 'complete' },
    })
  }

  // Settlements are facts about how submissions ended, and history carries
  // them precisely so a cold start knows what a crash knew. The live rule —
  // open tail takes the outcome, finished work stays finished, empty retry
  // attempts withdraw — applies here through the same function.
  //
  // A submission's records are recognised two ways: 2.0 stamps
  // `submissionId` on a snapshot's assistant messages (measured on a live
  // harness), so matching by id finds them; the position fallback - the
  // assistant messages between THIS settlement's user message and the next
  // one - stands for records that predate the stamp, and is what rescued the
  // cold start that once rendered four empty complete bubbles.
  for (const settlement of snapshot.settlements) {
    if (settlement.outcome === 'completed') continue

    let turnStart = -1
    let turnEnd = items.length
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item === undefined) continue
      if (turnStart === -1) {
        if (item.kind === 'user' && item.submissionId === settlement.submissionId) {
          turnStart = index
        }
        continue
      }
      if (item.kind === 'user') {
        turnEnd = index
        break
      }
    }

    const submissionId = settlement.submissionId
    const outcome = settlement.outcome
    settleSubmissionFailure(
      items,
      submissionId,
      (item, index) =>
        item.submissionId === submissionId ||
        (turnStart !== -1 && index > turnStart && index < turnEnd),
      outcome,
      settlement.error.message,
    )
  }

  return items
}

/* -------------------------------------------------------------------------- */
/* Application                                                                 */
/* -------------------------------------------------------------------------- */

export function emptyProjection(): TranscriptProjection {
  return {
    items: [],
    applied: null,
    openRuns: new Map(),
    openFileRuns: new Map(),
    callSites: new Map(),
    pending: null,
  }
}

/**
 * Holds the words of a submission the harness has admitted, until its own
 * message comes back.
 *
 * Takes the receipt's id rather than minting one, because the id is the whole
 * mechanism: it is what the echo will be recognised by. A submission whose
 * message is already in the log is not held at all — a reattach can deliver
 * the echo before this is ever called, and showing the words twice for a
 * frame is the failure this guard exists to prevent.
 */
export function withPendingSubmission(
  projection: TranscriptProjection,
  pending: PendingSubmission,
): TranscriptProjection {
  if (echoed(projection.items, pending)) return projection
  return { ...projection, pending }
}

/**
 * The pending submission drawn as the message it will become.
 *
 * Shaped here rather than at the component, so the one place that knows what
 * a user item is also decides what a not-yet-echoed one looks like. `id` is
 * the submission's, which is stable for as long as this is on screen and
 * belongs to nothing else; the timestamp is null because the log has not
 * stamped one yet and this must not invent it.
 */
export function pendingUserItem(
  pending: PendingSubmission,
): Extract<TranscriptItem, { kind: 'user' }> {
  return {
    kind: 'user',
    id: pending.submissionId,
    submissionId: pending.submissionId,
    text: pending.text,
    attachments: [],
    timestamp: null,
  }
}

/**
 * The map of open runs for freshly seeded items.
 *
 * A seed leaves its trailing text/thinking segment continuable: whatever
 * produced the stream may emit another delta for it, and that delta belongs
 * ON the tail — splitting "kept" and " grown" into adjacent segments
 * renders one paragraph as two for no reason. The last segment is the
 * continuation point by construction.
 */
function openRunsOf(items: readonly TranscriptItem[]): Map<string, OpenRun> {
  const runs = new Map<string, OpenRun>()
  for (const item of items) {
    if (item.kind !== 'assistant' || item.segments.length === 0) continue
    const last = item.segments[item.segments.length - 1]
    if (last === undefined || (last.kind !== 'text' && last.kind !== 'thinking')) continue
    runs.set(item.id, { kind: last.kind, index: item.segments.length - 1 })
  }
  return runs
}

/**
 * Whether this message is being written right now.
 *
 * Three facts must agree, and silence in any of them means no: the turn is
 * running (the phase says so — bytes stopping proves nothing), this is the
 * newest message, and the message itself has NOT reached an end state. A
 * crash-recovered `stopped` message under a live connection therefore shows
 * no caret: rendering an interrupted turn as actively writing is the same
 * lie as rendering it as finished, pointed the other way.
 */
export function isMessageBeingWritten(
  item: TranscriptItem,
  when: { readonly newest: boolean; readonly turnRunning: boolean },
): boolean {
  return (
    when.turnRunning &&
    when.newest &&
    item.kind === 'assistant' &&
    item.end.state === 'stopped'
  )
}

/**
 * Whether this item has anything on screen for a reader to look at.
 *
 * An assistant message exists from `message-started`, which is a fact about
 * the LOG, not about the page: until its first delta lands it has no segments
 * and renders as an empty box. Anything deciding what the tail of a
 * transcript should look like has to ask this rather than "is there an
 * assistant message", or it hands the screen over to a record with nothing in
 * it — which is exactly the second or more of blankness between the working
 * mark disappearing and the first reasoning arriving.
 */
export function hasVisibleContent(item: TranscriptItem): boolean {
  return item.kind === 'assistant' ? item.segments.length > 0 : true
}

/** A projection built from nothing but a snapshot — the cold start's opening state. */
export function seededProjection(snapshot: ConversationSnapshotFacts): TranscriptProjection {
  const items = seededFrom(snapshot)
  return {
    items,
    applied: null,
    openRuns: openRunsOf(items),
    openFileRuns: openFileRunsOf(items),
    callSites: callSitesOf(items),
    pending: null,
  }
}

/**
 * Derives each message's open file run from the built shape, so a live call
 * that continues after a seed merges into the row history built.
 *
 * The rule is the walk's own, read back off the final segments: the last
 * mutating call's row is the open run, written text between keeps it, a
 * thinking segment closes it, and a transparent row keeps it only when it is
 * a read of the run's own file. The seed and the live walk must agree here,
 * and the replay tests pin that they do.
 */
function openFileRunsOf(items: readonly TranscriptItem[]): Map<string, OpenFileRun> {
  const runs = new Map<string, OpenFileRun>()
  items.forEach((item) => {
    if (item.kind !== 'assistant') return
    let open: OpenFileRun | null = null
    item.segments.forEach((segment, segmentIndex) => {
      if (segment.kind === 'thinking') {
        open = null
        return
      }
      if (segment.kind !== 'tools') return
      segment.groups.forEach((group, groupIndex) => {
        const call = group.calls[0]
        if (call === undefined) return
        if (group.file !== null) {
          open = { segmentIndex, groupIndex, file: group.file }
          return
        }
        if (open !== null) {
          const path = readPathOf(call.toolName, call.input)
          if (path === null || path !== open.file) open = null
        }
      })
    })
    if (open !== null) runs.set(item.id, open)
  })
  return runs
}

/**
 * A snapshot replaces the log. It does not replace the receipt.
 *
 * `seededProjection` alone was wrong for a live conversation: a snapshot is
 * the whole state of the log as the harness knows it, and a message admitted
 * a moment ago may not be in the one that is already in flight towards us. A
 * reattach landing in that window would take the words off the screen and put
 * them back when the next delivery arrived. Carrying the pending submission
 * through, and letting `withPendingSubmission` drop it if the snapshot turns
 * out to contain its echo, makes a re-seed neutral either way.
 */
export function reseeded(
  current: TranscriptProjection,
  snapshot: ConversationSnapshotFacts,
): TranscriptProjection {
  const seeded = seededProjection(snapshot)
  return current.pending === null ? seeded : withPendingSubmission(seeded, current.pending)
}

/**
 * Applies one batch of chunk facts. Redelivered batches are dropped by
 * position; the rest mutate a cloned draft and come back as a new
 * projection, so feeding the same batch twice changes nothing beyond the
 * first time.
 */
export function applyChunks(
  projection: TranscriptProjection,
  chunks: readonly ChunkFacts[],
  /**
   * When this batch arrived here, or null when it was replayed rather than
   * lived through. Only thinking runs read it, and only to record the span
   * their deltas landed over; a replay's clock is the replay's, so it is
   * refused rather than believed. Defaults to null, which is the answer for
   * every caller that has no arrival time to offer.
   */
  arrivedAt: number | null = null,
): TranscriptProjection {
  const draft = draftOf(projection)
  let changed = false

  for (const chunk of chunks) {
    if (chunk.position !== null) {
      if (draft.applied !== null && atOrBefore(chunk.position, draft.applied)) continue
      draft.applied = chunk.position
    }
    applyChunk(draft, chunk, arrivedAt)
    changed = true
  }

  // A batch that was entirely redelivery changes nothing — returning the
  // input untouched lets React bail out of the render it would cause.
  return changed ? settle(draft) : projection
}

function applyChunk(draft: Draft, chunk: ChunkFacts, arrivedAt: number | null): void {
  switch (chunk.type) {
    case 'conversation-reset': {
      if (chunk.snapshot === null) return
      // A reset IS the state: everything accumulated so far is replaced —
      // including the indexes. A stale id index here would silently route
      // post-reset content to the wrong item or drop it.
      draft.items = seededFrom(chunk.snapshot)
      draft.openRuns = openRunsOf(draft.items)
      draft.assistants = assistantsOf(draft.items)
      draft.callSites = callSitesOf(draft.items)
      return
    }
    case 'message-appended': {
      const message = chunk.message
      if (message === null) return
      const seeded = seededFrom({
        version: 1,
        conversationId: null,
        offset: null,
        messages: [message],
        settlements: [],
      })
      const appended = seeded[0]
      // Also the exit for a system message appended live (an abort advisory
      // crossing the updates stream): seededFrom skips those on purpose.
      if (appended === undefined) return
      draft.items.push(appended)
      if (appended.kind === 'assistant') {
        draft.assistants.set(appended.id, draft.items.length - 1)
        for (const site of callSitesOf([appended])) draft.callSites.set(site[0], site[1])
        const runs = openRunsOf([appended])
        const run = runs.get(appended.id)
        if (run !== undefined) draft.openRuns.set(appended.id, run)
      }
      return
    }
    case 'message-started': {
      const messageId = chunk.messageId
      if (messageId === null) return
      if (!draft.assistants.has(messageId)) {
        draft.items.push({
          kind: 'assistant',
          id: messageId,
          submissionId: chunk.submissionId,
          model: chunk.model,
          segments: [],
          end: { state: 'stopped' },
          usage: null,
        })
        draft.assistants.set(messageId, draft.items.length - 1)
      }
      return
    }
    case 'message-delta': {
      if (chunk.messageId === null || chunk.delta === null || chunk.deltaKind === null) return
      appendDelta(
        draft,
        chunk.messageId,
        chunk.deltaKind === 'text' ? 'text' : 'thinking',
        chunk.delta,
        arrivedAt,
      )
      return
    }
    case 'tool-input': {
      if (chunk.messageId === null || chunk.toolCallId === null || chunk.toolName === null) return
      appendToolCall(draft, chunk.messageId, chunk.toolCallId, chunk.toolName, chunk.input)
      return
    }
    case 'tool-output': {
      if (chunk.toolCallId === null) return
      answerToolCall(draft, chunk.toolCallId, { output: chunk.output })
      return
    }
    case 'tool-output-error': {
      if (chunk.toolCallId === null) return
      answerToolCall(draft, chunk.toolCallId, { errorText: chunk.errorText ?? '' })
      return
    }
    case 'message-completed': {
      if (chunk.messageId === null) return
      const index = draft.assistants.get(chunk.messageId)
      if (index === undefined) return
      const item = draft.items[index]
      if (item === undefined || item.kind !== 'assistant') return
      draft.items[index] = {
        ...item,
        end: { state: 'complete' },
        usage: chunk.usage ?? item.usage,
      }
      return
    }
    case 'submission-settled': {
      const submissionId = chunk.submissionId
      const outcome = chunk.outcome
      if (submissionId === null || outcome === null || outcome === 'completed') return
      // The settlement's sentence rides along: it lands on whatever open
      // messages take the outcome, and on the failure item if the attempts
      // are withdrawn wholesale.
      const changed = settleSubmissionFailure(
        draft.items,
        submissionId,
        (item) => item.submissionId === submissionId,
        outcome,
        chunk.errorMessage,
      )
      if (!changed) return
      // Withdrawal and insertion shift item indexes; every id-indexed map is
      // rebuilt rather than patched, because a stale index silently routes
      // later content to the wrong item.
      draft.assistants = assistantsOf(draft.items)
      draft.callSites = callSitesOf(draft.items)
      return
    }
    default:
      // Unknown types are kept alive upstream precisely so THIS line stays
      // honest: their positions advanced the dedupe marker above, and their
      // content is unread by choice.
      return
  }
}
