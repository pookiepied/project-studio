import { useCallback, useEffect, useState } from 'react'

import { useConversation } from '@/features/chat/useConversation'
import type { ConversationContent } from '@/features/chat/useConversation'
import type { SeamFailure } from '@/platform/harness'
import {
  applyChunks,
  emptyProjection,
  seededProjection,
  type TranscriptItem,
} from '@/features/chat/transcript/projection'

/**
 * The transcript of a live conversation.
 *
 * `useConversation` owns the connection and forwards content; this hook owns
 * the reduction. The split is the one the architecture doc asks for: the
 * connection state machine never touches content, and this file never talks
 * to the harness. What a component gets is exactly two things -- items to
 * render and the phase they were produced in -- and nothing here can leak
 * either into a request.
 *
 * A snapshot REPLACES the projection; chunks apply on top. Both arrive from
 * the current read only (the hook drops superseded deliveries upstream), so
 * ordering is arrival order and replay safety lives in the reducer's
 * position discipline, not here.
 */
export function useConversationTranscript(conversationId: string): {
  items: readonly TranscriptItem[]
  phase: ReturnType<typeof useConversation>['phase']
  offset: string | null
  resume: () => void
  submit: (message: string) => Promise<{ ok: boolean }>
  abort: () => Promise<{ ok: boolean }>
  refused: SeamFailure | null
  dismissRefusal: () => void
} {
  const [projection, setProjection] = useState(emptyProjection)

  const onContent = useCallback((content: ConversationContent) => {
    setProjection((current) =>
      content.kind === 'snapshot'
        ? seededProjection(content.snapshot)
        : applyChunks(current, content.chunks),
    )
  }, [])

  const conversation = useConversation(conversationId, { onContent })

  // Switching conversations starts a new transcript immediately: the old
  // items belong to another id, and a delivery for the new one must never
  // land on top of them.
  useEffect(() => {
    setProjection(emptyProjection())
  }, [conversationId])

  return {
    items: projection.items,
    phase: conversation.phase,
    offset: conversation.offset,
    resume: conversation.resume,
    submit: async (message) => {
      const sent = await conversation.submit(message)
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
