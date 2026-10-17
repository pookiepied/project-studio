import { useCallback, useEffect, useRef, useState } from 'react'
import { recordClientObservation } from '@/platform/diagnostics/events'

import { useConversation } from '@/features/chat/connection/useConversation'
import type { ConversationContent } from '@/features/chat/connection/useConversation'
import type { SeamFailure, TurnImageWire, TurnSettingsWire } from '@/platform/harness'
import { firstAdmission } from '@/features/chat/connection/first-attach'
import { queuedMessages, forgetQueued } from './queued-messages'
import {
  applyChunks,
  emptyProjection,
  reseeded,
  withPendingSubmission,
  type PendingSubmission,
  type TranscriptItem,
  type TranscriptProjection,
} from '@/features/chat/transcript/projection'

/**
 * The transcript of a live conversation.
 *
 * `useConversation` owns the connection and forwards content; this hook owns
 * the reduction. The split is the one the architecture doc asks for: the
 * connection state machine never touches content, and this file never talks
 * to the harness. What a component gets is exactly two things — items to
 * render and the phase they were produced in — and nothing here can leak
 * either into a request.
 *
 * A snapshot REPLACES the projection; chunks apply on top. Both arrive from
 * the current read only (the hook drops superseded deliveries upstream), so
 * ordering is arrival order and replay safety lives in the reducer's
 * position discipline, not here.
 */
/**
 * When a delivery arrived here, or null when it did not happen here at all.
 *
 * `replaying` has been on every chunk delivery since Task 24 and nothing read
 * it. It is exactly the distinction anything measuring durations needs: a
 * reattach hands back a two-minute reasoning trace in fifty milliseconds, and
 * a timer started on arrival would report the reattach's speed as the model's
 * thinking time. Replayed batches and snapshots therefore carry no time, and
 * a reasoning run built from them claims no duration.
 *
 * The clock is a parameter because a rule about time is exactly the kind that
 * cannot be tested against `Date.now`.
 */
export function arrivalTimeOf(content: ConversationContent, now: () => number): number | null {
  if (content.kind !== 'chunks') return null
  return content.replaying ? null : now()
}

/**
 * What a conversation shows before any delivery has reached it.
 *
 * Empty, unless this conversation was opened by its own first turn. Those
 * words were typed on another page and admitted there, and the receipt carried
 * across the navigation (`first-attach.ts`) names both the submission and the
 * text — so the first thing this view can put on screen is the message it
 * exists because of, rather than an empty column for the length of a round
 * trip. Built during render rather than in an effect for the same reason the
 * opening phase is: an effect is a frame late, and a frame of blankness at the
 * exact moment someone is looking for their own message is the defect.
 */
function openingProjection(conversationId: string): TranscriptProjection {
  const opening = firstAdmission(conversationId)
  return opening === null
    ? emptyProjection()
    : withPendingSubmission(emptyProjection(), {
        submissionId: opening.submissionId,
        text: opening.text,
      })
}

export function useConversationTranscript(conversationId: string): {
  items: readonly TranscriptItem[]
  /** Words this window sent that the log has not echoed back yet. */
  pending: PendingSubmission | null
  queued?: readonly PendingSubmission[]
  phase: ReturnType<typeof useConversation>['phase']
  offset: string | null
  resume: () => void
  submit: (
    message: string,
    settings: TurnSettingsWire,
    images?: readonly TurnImageWire[],
  ) => Promise<{ ok: boolean }>
  abort: () => Promise<{ ok: boolean }>
  refused: SeamFailure | null
  dismissRefusal: () => void
} {
  const [projection, setProjection] = useState(() => openingProjection(conversationId))
  const [queued, setQueued] = useState(() => queuedMessages(conversationId))
  // Which id the state above currently describes. The effect below re-seeds on
  // a change of conversation, and without this it would also re-seed on the
  // mount that just built the same thing — a second render of identical
  // content on every conversation opened.
  const seededFor = useRef(conversationId)

  const onContent = useCallback((content: ConversationContent) => {
    recordClientObservation({ name: 'client.projection', phase: 'progress', identity: { conversationId },
      attributes: { stage: 'delivery_received', kind: content.kind, replaying: content.kind !== 'chunks' || content.replaying } })
    const consumed = new Set<string>()
    if (content.kind === 'snapshot') {
      for (const message of content.snapshot.messages) {
        if (message.submissionId !== null) consumed.add(message.submissionId)
      }
      for (const item of content.snapshot.settlements) consumed.add(item.submissionId)
    } else {
      for (const chunk of content.chunks) {
        if ((chunk.type === 'message-started' || chunk.type === 'submission-settled') && chunk.submissionId !== null) {
          consumed.add(chunk.submissionId)
        }
      }
    }
    forgetQueued(conversationId, consumed)
    setQueued(queuedMessages(conversationId))
    const arrivedAt = arrivalTimeOf(content, Date.now)
    setProjection((current) =>
      content.kind === 'snapshot'
        ? reseeded(current, content.snapshot)
        : applyChunks(current, content.chunks, arrivedAt),
    )
  }, [conversationId])

  const conversation = useConversation(conversationId, { onContent })

  // Switching conversations starts a new transcript immediately: the old
  // items belong to another id, and a delivery for the new one must never
  // land on top of them.
  useEffect(() => {
    if (seededFor.current === conversationId) return
    seededFor.current = conversationId
    setProjection(openingProjection(conversationId))
    setQueued(queuedMessages(conversationId))
  }, [conversationId])

  return {
    items: projection.items,
    pending: projection.pending,
    queued,
    phase: conversation.phase,
    offset: conversation.offset,
    resume: conversation.resume,
    submit: async (message, settings, images) => {
      const sent = await conversation.submit(message, settings, images)
      if (seededFor.current !== conversationId) return { ok: sent.ok }
      // Held only once the harness says it has the words. A submission that
      // was refused leaves the composer holding them (Task 32), and drawing
      // them in the transcript as well would show the same message in two
      // places, one of which is a claim that it was sent.
      if (sent.ok && settings.deliveryMode !== 'queue') {
        const admitted = sent.value.submissionId
        setProjection((current) =>
          withPendingSubmission(current, { submissionId: admitted, text: message }),
        )
      }
      setQueued(queuedMessages(conversationId))
      return { ok: sent.ok }
    },
    abort: async () => {
      const aborted = await conversation.abort()
      return { ok: aborted.ok }
    },
    refused: conversation.refused,
    dismissRefusal: conversation.dismissRefusal,
  }
}
