/**
 * What a person reads: the items of the transcript, the segments of an
 * assistant turn, and how a message ended. Nothing here knows how it was
 * built.
 */

import type { ModelRefFacts, Present, UsageFacts } from '@/platform/harness'

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
  | {
      /**
       * Where the conversation was compacted. The items above it are still
       * the log and still readable; from here the model reads the summary
       * instead of them. One line at rest, the summary behind a disclosure.
       */
      readonly kind: 'compaction'
      readonly id: string
      readonly summary: string
      /** What the window held when the compaction ran. */
      readonly tokensBefore: number
      readonly timestamp: string | null
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
}
