import { StudioMark } from '@/components/brand'
import { EarlierBoundary, useTranscriptWindow } from '@/features/chat/transcript/paging'
import { AssistantTurn } from '@/features/chat/transcript/live/AssistantTurn'
import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import { RetryWait } from '@/features/chat/transcript/live/RetryWait'
import { SubmissionFailed } from '@/features/chat/transcript/live/SubmissionFailed'
import type { ConversationPhase } from '@/features/chat/useConversation'
import {
  isMessageBeingWritten,
  type TranscriptItem,
} from '@/features/chat/transcript/projection'

/**
 * The list of turns in a live conversation.
 *
 * Deliberately thin, like its demo sibling: it decides which component an
 * item gets and where the working indicator goes, and nothing else. Every
 * behaviour lives in the component that owns it.
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
 */
export function LiveTranscript({
  items,
  phase,
  viewport,
}: {
  items: readonly TranscriptItem[]
  phase: ConversationPhase
  /** The scroll container, needed to hold position while paging older turns. */
  viewport: React.RefObject<HTMLElement | null>
}) {
  const last = items[items.length - 1]
  const lastAssistantId = last?.kind === 'assistant' ? last.id : null
  // A turn is being produced only while the phase says so. The newest
  // message being unfinished (a crash left it stopped) is not the same as a
  // turn running right now, and only the phase knows which it is.
  const turnRunning = phase.status === 'streaming'
  const retrying = phase.status === 'streaming' ? phase.retrying : null

  const { visible, hasOlder, loading, sentinel } = useTranscriptWindow(items, viewport)

  return (
    <div className="flex flex-col gap-6">
      {hasOlder ? <EarlierBoundary loading={loading} ref={sentinel} /> : null}

      {visible.map((item) =>
        item.kind === 'user' ? (
          <LiveUserMessage key={item.id} item={item} />
        ) : item.kind === 'submission-failed' ? (
          <SubmissionFailed key={item.id} item={item} />
        ) : (
          <AssistantTurn
            key={item.id}
            item={item}
            live={
              turnRunning &&
              retrying === null &&
              isMessageBeingWritten(item, {
                newest: item.id === lastAssistantId,
                turnRunning,
              })
            }
          />
        ),
      )}

      {/* The two live indicators at the tail of the list. A retry wait is
          named in words because "nothing is moving" and "the provider said
          no" look identical without them — that was the defect this signal
          exists to end. Otherwise the gap between sending and the first
          token gets the mark's own ripple and nothing else: no "Thinking..."
          label, because the glyph already animates. */}
      {turnRunning && retrying !== null ? (
        <RetryWait retrying={retrying} />
      ) : phase.status === 'streaming' &&
        (visible[visible.length - 1]?.kind ?? null) !== 'assistant' ? (
        <StudioMark busy size={16} className="text-foreground/45" />
      ) : null}
    </div>
  )
}
