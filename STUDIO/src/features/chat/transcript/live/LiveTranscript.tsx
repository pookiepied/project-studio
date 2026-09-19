import { EarlierBoundary, useTranscriptWindow } from '@/features/chat/transcript/paging'
import { AssistantTurn } from '@/features/chat/transcript/live/AssistantTurn'
import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import { RetryWait } from '@/features/chat/transcript/live/RetryWait'
import { SubmissionFailed } from '@/features/chat/transcript/live/SubmissionFailed'
import { CompactionMarker } from '@/features/chat/transcript/live/CompactionMarker'
import { isTurnRunning, type ConversationPhase } from '@/features/chat/connection/useConversation'
import {
  isMessageBeingWritten,
  pendingUserItem,
  type PendingSubmission,
  type TranscriptItem,
} from '@/features/chat/transcript/projection'

/**
 * The list of turns in a live conversation.
 *
 * Deliberately thin, like its demo sibling: it decides which component an
 * item gets, and nothing else. Every behaviour lives in the component that
 * owns it.
 *
 * The one judgement this list makes is which assistant message is LIVE —
 * the newest one while a turn has not settled. That bit drives the caret and
 * the thinking ripple and nothing else; whether any message reads as
 * finished was decided by the projection from settlement facts, never here,
 * never from silence.
 *
 * A scheduled retry is the one state where a running turn produces nothing:
 * the harness said so on the wire, and while its wait lasts the caret would
 * be a lie, so the turn reads as paused and the wait line speaks instead.
 *
 * ---- The tail is one thing, drawn once ---------------------------------------
 *
 * Everything below the last logged item used to be assembled here out of
 * pieces that knew nothing about each other: the person's own message was not
 * drawn at all until the harness echoed it, and the gap before the first token
 * was drawn as a bare mark that a thinking block elsewhere would later
 * replace. Three separate appearances for one continuous event, and the order
 * they happened in is what the screen showed: a mark alone, the mark shoved
 * down by an echo arriving above it, the mark gone, a thinking block in its
 * place. None of the components was wrong on its own, which is why it survived
 * so long. The tail has one owner now — this file — and one shape: the sent
 * message, and then whatever the model actually produces, when it produces it.
 * The gap in between draws nothing, because there is nothing there yet.
 */
export function LiveTranscript({
  items,
  pending,
  phase,
  viewport,
  conversationId,
  onBranch,
}: {
  items: readonly TranscriptItem[]
  /**
   * Words sent from this window that the log has not echoed back yet. Drawn
   * below every item because a submission the harness has admitted is newer
   * than anything it has told us about.
   */
  pending: PendingSubmission | null
  phase: ConversationPhase
  /** The scroll container, needed to hold position while paging older turns. */
  viewport: React.RefObject<HTMLElement | null>
  /** The conversation the tool calls ran in, which keys their attachments. */
  conversationId: string
  /** Forks the conversation with everything up to the named answer. */
  onBranch?: (messageId: string) => void
}) {
  // The newest assistant message, which is not the same as "the last item, if
  // it happens to be one". The log can put a user message after a reply has
  // opened — a second submission, or an echo that lands behind its own
  // `message-started` — and reading only the tail made the reply being written
  // stop counting as newest at that moment: its caret went out and
  // "Stopped before finishing" appeared under text that was still arriving.
  const lastAssistantId = newestAssistantId(items)
  // Two different questions. `turnRunning` is "the harness has a turn of
  // ours", true from the admission receipt onward, and the only thing left
  // that answers to it is the retry wait. `generating` is "text is being
  // produced right now", which is the only thing a caret or a paced reveal
  // may be shown for: nothing is being written between admission and the
  // first token, and a caret there would be a picture of typing that is not
  // happening.
  const turnRunning = isTurnRunning(phase)
  const generating = phase.status === 'streaming'
  const retrying = phase.status === 'streaming' ? phase.retrying : null
  // The submission a run in flight still owes its ending. Messages that carry
  // this id keep their action row down — see `AssistantTurn` — while
  // everything said before the run keeps its verbs.
  const inFlightSubmission =
    phase.status === 'submitted' || phase.status === 'streaming' ? phase.submissionId : null

  const { visible, hasOlder, loading, sentinel } = useTranscriptWindow(items, viewport)

  // An item that will draw nothing must not take a slot. This list is a
  // `gap-6` column, and a flex child of zero height still gets the gap: an
  // assistant message that exists in the log with no content yet — the whole
  // window between `message-started` and the first delta — was pushing
  // everything below it down by 24px and pulling it back when the content
  // arrived. Measured on a real turn, that is the reasoning row appearing,
  // sitting still for nine seconds, dropping 24px, and returning. Nothing was
  // wrong with what any component drew; the space was reserved by the list.
  const drawn = visible.filter((item) => !drawsNothing(item, lastAssistantId, generating))

  return (
    <div className="flex flex-col gap-6">
      {hasOlder ? <EarlierBoundary loading={loading} ref={sentinel} /> : null}

      {drawn.map((item) =>
        item.kind === 'user' ? (
          <LiveUserMessage key={item.id} item={item} />
        ) : item.kind === 'submission-failed' ? (
          <SubmissionFailed key={item.id} item={item} />
        ) : item.kind === 'compaction' ? (
          <CompactionMarker key={item.id} item={item} />
        ) : (
          <AssistantTurn
            key={item.id}
            item={item}
            conversationId={conversationId}
            live={
              generating &&
              retrying === null &&
              isMessageBeingWritten(item, {
                newest: item.id === lastAssistantId,
                turnRunning: generating,
              })
            }
            turnInFlight={
              inFlightSubmission !== null &&
              item.submissionId !== null &&
              item.submissionId === inFlightSubmission
            }
            {...(onBranch === undefined ? {} : { onBranch })}
          />
        ),
      )}

      {/* The message this window sent, standing where the log will put it.
          Above the turn's row and below every item, because that is where it
          belongs and where it will stay — when the echo lands, the projection
          drops this and the real item is already in the list above, so the
          swap moves nothing. */}
      {pending !== null ? <LiveUserMessage item={pendingUserItem(pending)} /> : null}

      {/* A scheduled retry, and nothing else. It is named in words because
          "nothing is moving" and "the provider said no" look identical
          without them — that was the defect this signal exists to end.

          The ordinary silence before a reply gets no row at all. It used to
          get one, counting and calling itself "Working", and the objection
          that retired it was the true one: a turn being in flight is already
          said by the ring on the send control, at the reader's own hand, from
          the instant they send. A second indicator saying the same thing in
          vaguer words, sitting in the transcript where content goes, is one
          indicator too many. The transcript says nothing until the model
          gives it something to say. */}
      {turnRunning && retrying !== null ? <RetryWait retrying={retrying} /> : null}
    </div>
  )
}

/**
 * The newest assistant message in the log, wherever it sits.
 *
 * Scans backwards because the answer is at the end in every ordinary case and
 * this runs on every render of a growing list.
 */
function newestAssistantId(items: readonly TranscriptItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && item.kind === 'assistant') return item.id
  }
  return null
}

/**
 * Whether this item would put nothing at all on the page.
 *
 * Exactly one item can: an assistant message the log has opened whose first
 * delta has not arrived, while its own turn is still producing — it has no
 * segments to draw, and `AssistantTurn` withholds the ending because the
 * message has not reached one. Every other empty-looking case still draws
 * something, and the distinction matters: a message left with no content by a
 * crash or an abort must keep its slot and its "stopped" line, because that
 * line is the only evidence on screen that a turn happened at all.
 */
function drawsNothing(
  item: TranscriptItem,
  newestAssistant: string | null,
  generating: boolean,
): boolean {
  if (item.kind !== 'assistant') return false
  if (item.segments.length > 0) return false
  return generating && item.id === newestAssistant && item.end.state === 'stopped'
}
