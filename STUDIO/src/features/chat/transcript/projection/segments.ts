/**
 * How a chunk grows an assistant turn: a delta appends to the open run of
 * its kind or opens a new one, a tool call opens a row or continues a run,
 * and a tool result finds the call it answers by its remembered site.
 */

import type { ConversationMessageFacts, Present } from '@/platform/harness'
import type { Draft } from './draft'
import type { ToolCallView, ToolGroupView, TranscriptItem } from './shapes'
import { fileOf, pushCall, readPathOf } from './rows'

export function emptyAssistant(message: ConversationMessageFacts): Extract<
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
export function assistantAt(
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
export function appendDelta(
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
export function appendToolCall(
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
export function answerToolCall(
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
