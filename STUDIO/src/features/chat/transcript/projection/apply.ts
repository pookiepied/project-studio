/**
 * The entry points: an empty projection, a pending submission echoed ahead
 * of the wire, and the application of a batch of chunks, idempotent under
 * replay.
 */

import type { ChunkFacts, ConversationSnapshotFacts } from '@/platform/harness'
import {
  assistantsOf,
  atOrBefore,
  callSitesOf,
  draftOf,
  echoed,
  openFileRunsOf,
  openRunsOf,
  settle,
  type Draft,
  type TranscriptProjection,
} from './draft'
import type { PendingSubmission, TranscriptItem } from './shapes'
import { answerToolCall, appendDelta, appendToolCall } from './segments'
import { seededFrom } from './seed'
import { settleSubmissionFailure } from './settlement'

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

export function applyChunk(draft: Draft, chunk: ChunkFacts, arrivedAt: number | null): void {
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
        compactions: [],
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
