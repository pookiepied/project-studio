/**
 * What a failed submission does to the messages it produced. An open message
 * takes the outcome; a message that closed without ever producing content is
 * withdrawn; a message that closed with content keeps its completion; and if
 * nothing is left standing, one failure item takes the attempts' place.
 */

import type { TranscriptItem } from './shapes'

export type AssistantItem = Extract<TranscriptItem, { kind: 'assistant' }>

/** Which items a failed or aborted submission owns, position included. */
export type BelongsTo = (item: AssistantItem, index: number) => boolean

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
export function settleSubmissionFailure(
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
