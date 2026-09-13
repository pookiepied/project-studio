/**
 * The projection's own state between batches: the items, the last applied
 * position, and the indexes that let a later chunk find the message, the
 * tool call or the file run it continues. The draft is the mutable form the
 * appliers write to and settle back into a projection.
 */

import type { ChunkPosition } from '@/platform/harness'
import type { PendingSubmission, TranscriptItem } from './shapes'
import { readPathOf } from './rows'

/**
 * Where the next delta of each kind would attach, per message. Bookkeeping,
 * not content: it exists so a delta extends the segment the previous delta
 * opened, across however many deliveries that takes.
 */
export interface OpenRun {
  readonly kind: 'text' | 'thinking'
  readonly index: number
}

/** Where one tool call lives, so its answer can find it from a later batch. */
export interface CallSite {
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

/**
 * The mutable working shape behind an immutable `TranscriptProjection`.
 * Functions below clone shallowly, apply a whole batch, and hand back a new
 * immutable projection — React sees fresh objects, nothing downstream can
 * observe a half-applied batch.
 */
export interface Draft {
  items: TranscriptItem[]
  applied: ChunkPosition | null
  /** Assistant item index by message id. */
  assistants: Map<string, number>
  openRuns: Map<string, OpenRun>
  openFileRuns: Map<string, OpenFileRun>
  callSites: Map<string, CallSite>
  pending: PendingSubmission | null
}

export function draftOf(projection: TranscriptProjection): Draft {
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
export function echoed(items: readonly TranscriptItem[], pending: PendingSubmission): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item === undefined) continue
    if (item.kind === 'user' && item.submissionId === pending.submissionId) return true
  }
  return false
}

export function settle(draft: Draft): TranscriptProjection {
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
export function atOrBefore(a: ChunkPosition, b: ChunkPosition): boolean {
  return a.batch < b.batch || (a.batch === b.batch && a.index <= b.index)
}

export function assistantsOf(items: readonly TranscriptItem[]): Map<string, number> {
  const indexes = new Map<string, number>()
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item.kind === 'assistant') indexes.set(item.id, index)
  }
  return indexes
}

export function callSitesOf(items: readonly TranscriptItem[]): Map<string, CallSite> {
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
 * The map of open runs for freshly seeded items.
 *
 * A seed leaves its trailing text/thinking segment continuable: whatever
 * produced the stream may emit another delta for it, and that delta belongs
 * ON the tail — splitting "kept" and " grown" into adjacent segments
 * renders one paragraph as two for no reason. The last segment is the
 * continuation point by construction.
 */
export function openRunsOf(items: readonly TranscriptItem[]): Map<string, OpenRun> {
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
 * Derives each message's open file run from the built shape, so a live call
 * that continues after a seed merges into the row history built.
 *
 * The rule is the walk's own, read back off the final segments: the last
 * mutating call's row is the open run, written text between keeps it, a
 * thinking segment closes it, and a transparent row keeps it only when it is
 * a read of the run's own file. The seed and the live walk must agree here,
 * and the replay tests pin that they do.
 */
export function openFileRunsOf(items: readonly TranscriptItem[]): Map<string, OpenFileRun> {
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
