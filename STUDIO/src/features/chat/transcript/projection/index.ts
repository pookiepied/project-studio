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


export type {
  ToolCallView,
  ToolGroupView,
  AssistantSegment,
  MessageEnd,
  TranscriptItem,
  PendingSubmission,
} from './shapes'

export type {
  TranscriptProjection,
} from './draft'

export {
  seededFrom,
} from './seed'

export {
  emptyProjection,
  withPendingSubmission,
  pendingUserItem,
  isMessageBeingWritten,
  seededProjection,
  reseeded,
  applyChunks,
} from './apply'
