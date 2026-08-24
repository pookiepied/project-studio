/**
 * The UI transcript, reduced from chunk facts.
 *
 * What the model receives and what renders here are two projections of the
 * same event log, and neither is derived from the other (transcript-and-
 * rendering.md section 1). This module owns the UI side. It consumes what
 * `useConversation` forwards -- history snapshots and update chunks -- and
 * produces the ordered items a person reads. Nothing here ever flows back up
 * into a request.
 *
 * ---- Grouping is structural, never inferred -------------------------------
 *
 * The unit is ONE ASSISTANT MESSAGE'S tool calls, bucketed by tool kind --
 * both halves are facts already in the log (the message id on every
 * `tool-input`, the tool name beside it). No semantic labels exist here and
 * none may be added: a label the model did not emit is a guess wearing a
 * fact's clothes. Buckets render as counts ("Read 3"), expandable to the
 * calls, which expand to their input and output.
 *
 * ---- Thinking blocks are segments, not a mutable block --------------------
 *
 * Reasoning deltas accumulate into per-segment blocks positioned where they
 * occurred, keyed by message id and ordinal -- because we reattach at an
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
 * settlement says so. Silence proves nothing -- a stream that stops
 * mid-sentence leaves a visibly unfinished message behind, whatever the
 * connection does afterwards.
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
 * One bucket of same-named tool calls within one tools segment. The identity
 * is message, segment, and tool name together, so it survives a replay
 * unchanged.
 */
export interface ToolGroupView {
  readonly toolName: string
  readonly calls: readonly ToolCallView[]
}

export type AssistantSegment =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'thinking'; readonly id: string; readonly text: string }
  | { readonly kind: 'tools'; readonly id: string; readonly groups: readonly ToolGroupView[] }

/** How a message ended, as far as the log can prove. */
export type MessageEnd =
  | { readonly state: 'complete' }
  | { readonly state: 'stopped' }
  | { readonly state: 'failed' }
  | { readonly state: 'aborted' }

export interface UserAttachmentView {
  readonly mediaType: string
  readonly filename: string | null
  readonly size: number | null
}

export type TranscriptItem =
  | {
      readonly kind: 'user'
      readonly id: string
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

export interface TranscriptProjection {
  readonly items: readonly TranscriptItem[]
  /** The ordering token everything above was built from. */
  readonly applied: ChunkPosition | null
  readonly openRuns: ReadonlyMap<string, OpenRun>
  readonly callSites: ReadonlyMap<string, CallSite>
}

/* -------------------------------------------------------------------------- */
/* Internal draft                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The mutable working shape behind an immutable `TranscriptProjection`.
 * Functions below clone shallowly, apply a whole batch, and hand back a new
 * immutable projection -- React sees fresh objects, nothing downstream can
 * observe a half-applied batch.
 */
interface Draft {
  items: TranscriptItem[]
  applied: ChunkPosition | null
  /** Assistant item index by message id. */
  assistants: Map<string, number>
  openRuns: Map<string, OpenRun>
  callSites: Map<string, CallSite>
}

function draftOf(projection: TranscriptProjection): Draft {
  return {
    items: [...projection.items],
    applied: projection.applied,
    assistants: assistantsOf(projection.items),
    openRuns: new Map(projection.openRuns),
    callSites: new Map(projection.callSites),
  }
}

function settle(draft: Draft): TranscriptProjection {
  return {
    items: draft.items,
    applied: draft.applied,
    openRuns: draft.openRuns,
    callSites: draft.callSites,
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

function assistantAt(draft: Draft, messageId: string): Extract<
  TranscriptItem,
  { kind: 'assistant' }
> | null {
  const index = draft.assistants.get(messageId)
  if (index === undefined) return null
  const item = draft.items[index]
  return item !== undefined && item.kind === 'assistant' ? item : null
}

/** Appends one delta to the message's open run of that kind, opening a new run if needed. */
function appendDelta(
  draft: Draft,
  messageId: string,
  kind: 'text' | 'thinking',
  text: string,
): void {
  const item = assistantAt(draft, messageId)
  if (item === null) return

  const segments = [...item.segments]
  const open = draft.openRuns.get(messageId)
  if (open !== undefined && open.kind === kind) {
    const segment = segments[open.index]
    if (segment !== undefined && segment.kind === kind) {
      segments[open.index] = { ...segment, text: segment.text + text }
      draft.items[draft.assistants.get(messageId) ?? -1] = { ...item, segments }
      return
    }
  }

  // A different kind is open, or none: this delta begins a new segment.
  draft.openRuns.delete(messageId)
  const ordinal = segments.filter((candidate) => candidate.kind === kind).length
  segments.push(
    kind === 'text'
      ? { kind: 'text', id: `${messageId}#text-${ordinal}`, text }
      : { kind: 'thinking', id: `${messageId}#think-${ordinal}`, text },
  )
  draft.openRuns.set(messageId, { kind, index: segments.length - 1 })
  draft.items[draft.assistants.get(messageId) ?? -1] = { ...item, segments }
}

/**
 * Adds a tool call to the message's OPEN tools segment, or opens a new one
 * after whatever was being written -- the interleaving is the story of the
 * turn, and grouping must not flatten it away.
 */
function appendToolCall(
  draft: Draft,
  messageId: string,
  toolCallId: string,
  toolName: string,
  input: Present<unknown> | null,
): void {
  const item = assistantAt(draft, messageId)
  if (item === null) return

  draft.openRuns.delete(messageId)

  const segments = [...item.segments]
  let segmentIndex = segments.length - 1
  let segment = segments[segmentIndex]
  if (segment === undefined || segment.kind !== 'tools') {
    segment = { kind: 'tools', id: `${messageId}#tools-${segments.length}`, groups: [] }
    segments.push(segment)
    segmentIndex = segments.length - 1
  }
  if (segment.kind !== 'tools') return

  const groups = [...segment.groups]
  let groupIndex = groups.findIndex((group) => group.toolName === toolName)
  if (groupIndex === -1) {
    groups.push({ toolName, calls: [] })
    groupIndex = groups.length - 1
  }
  const group = groups[groupIndex]
  const calls: ToolCallView[] = [
    ...group.calls,
    { toolCallId, toolName, input, output: null, errorText: null },
  ]
  groups[groupIndex] = { ...group, calls }

  segments[segmentIndex] = { ...segment, groups }
  draft.items[draft.assistants.get(messageId) ?? -1] = { ...item, segments }
  draft.callSites.set(toolCallId, {
    itemIndex: draft.assistants.get(messageId) ?? -1,
    segmentIndex,
    groupIndex,
    callIndex: calls.length - 1,
  })
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

/** Marks every unfinished message of a submission with how its turn ended. */
function markSubmissionEnded(
  draft: Draft,
  submissionId: string,
  end: MessageEnd,
): void {
  for (let index = 0; index < draft.items.length; index += 1) {
    const item = draft.items[index]
    if (item.kind !== 'assistant' || item.submissionId !== submissionId) continue
    if (item.end.state === 'complete') continue
    draft.items[index] = { ...item, end }
  }
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
 * Builds items from a whole materialized conversation -- the history view's
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
        })
        thinkingRuns += 1
      } else if (part.kind === 'tool') {
        // Consecutive tool parts share one segment; a run interrupted by
        // written text starts another, preserving the interleaving.
        const last = segments[segments.length - 1]
        const segment =
          last !== undefined && last.kind === 'tools'
            ? last
            : ({ kind: 'tools', id: `${message.id}#tools-${segments.length}`, groups: [] } as const)
        if (segment.kind !== 'tools') continue
        const groups = [...segment.groups]
        const groupIndex = groups.findIndex((group) => group.toolName === part.toolName)
        const group =
          groupIndex === -1 ? { toolName: part.toolName, calls: [] } : groups[groupIndex]
        const nextGroupIndex = groupIndex === -1 ? groups.length : groupIndex
        groups[nextGroupIndex] = {
          ...group,
          calls: [
            ...group.calls,
            {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input ?? null,
              output: part.output ?? null,
              errorText: part.errorText ?? null,
            },
          ],
        }
        const nextSegment = { ...segment, groups }
        if (last !== undefined && last.kind === 'tools') {
          segments[segments.length - 1] = nextSegment
        } else {
          segments.push(nextSegment)
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
  // them precisely so a cold start knows what a crash knew. A message still
  // unfinished under a failed/aborted submission takes that outcome -- the
  // same rule the live path applies -- while genuinely finished messages of
  // the same submission stay finished.
  for (const settlement of snapshot.settlements) {
    if (settlement.outcome === 'completed') continue
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item.kind !== 'assistant' || item.submissionId !== settlement.submissionId) continue
      if (item.end.state === 'complete') continue
      items[index] = { ...item, end: { state: settlement.outcome } }
    }
  }

  return items
}

/* -------------------------------------------------------------------------- */
/* Application                                                                 */
/* -------------------------------------------------------------------------- */

export function emptyProjection(): TranscriptProjection {
  return { items: [], applied: null, openRuns: new Map(), callSites: new Map() }
}

/**
 * The map of open runs for freshly seeded items.
 *
 * A seed leaves its trailing text/thinking segment continuable: whatever
 * produced the stream may emit another delta for it, and that delta belongs
 * ON the tail -- splitting "kept" and " grown" into adjacent segments
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
 * running (the phase says so -- bytes stopping proves nothing), this is the
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

/** A projection built from nothing but a snapshot -- the cold start's opening state. */
export function seededProjection(snapshot: ConversationSnapshotFacts): TranscriptProjection {
  const items = seededFrom(snapshot)
  return {
    items,
    applied: null,
    openRuns: openRunsOf(items),
    callSites: callSitesOf(items),
  }
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
): TranscriptProjection {
  const draft = draftOf(projection)
  let changed = false

  for (const chunk of chunks) {
    if (chunk.position !== null) {
      if (draft.applied !== null && atOrBefore(chunk.position, draft.applied)) continue
      draft.applied = chunk.position
    }
    applyChunk(draft, chunk)
    changed = true
  }

  // A batch that was entirely redelivery changes nothing -- returning the
  // input untouched lets React bail out of the render it would cause.
  return changed ? settle(draft) : projection
}

function applyChunk(draft: Draft, chunk: ChunkFacts): void {
  switch (chunk.type) {
    case 'conversation-reset': {
      if (chunk.snapshot === null) return
      // A reset IS the state: everything accumulated so far is replaced --
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
      if (chunk.submissionId === null || chunk.outcome === null) return
      if (chunk.outcome !== 'completed') {
        markSubmissionEnded(draft, chunk.submissionId, { state: chunk.outcome })
      }
      return
    }
    default:
      // Unknown types are kept alive upstream precisely so THIS line stays
      // honest: their positions advanced the dedupe marker above, and their
      // content is unread by choice.
      return
  }
}
