import { useCallback } from 'react'

import { newId } from '@/lib/id'
import type { Conversation, Message, SessionStatus } from '@/domain/session/types'
import { useDemoTurn, type TurnRun } from '@/stores/workspace/useDemoTurn'
import { GALLERY_CONVERSATION_ID } from '@/domain/session/gallery'

/**
 * The demo turn path, kept exactly as reachable as it was.
 *
 * Since Task 33 every real conversation submits through the harness and
 * renders from its stream. What still answers through this hook is only what
 * has no stream: the artifact gallery's staged reply (`ChatPage` withholds
 * `onSend` there), and nothing else — these callbacks check the gallery id on
 * purpose so a future caller cannot quietly route a demo turn at a real
 * conversation's record.
 *
 * Kept rather than deleted because Task 37 makes more of this path
 * unreachable than any task before it; the removal is its own decision.
 */
export interface LegacyTurns {
  run: (conversationId: string, options: TurnRun) => void
  cancel: () => void
  /** The gallery's own composer path; a project argument has nothing to mean. */
  send: (conversationId: string | null, text: string) => string
  retry: (conversationId: string) => void
  editMessage: (conversationId: string, messageId: string, text: string) => void
  fork: (conversationId: string, messageId: string) => string | null
}

export function useDemoTurns(options: {
  readonly status: React.Dispatch<React.SetStateAction<SessionStatus>>
  /** The model the turn is sent with, as of when it starts; null is the default. */
  readonly modelId: () => string | null
  readonly markRunning: (conversationId: string, active: boolean) => void
  /** Finds a conversation as of this render; null when it does not exist. */
  readonly findConversation: (conversationId: string) => Conversation | undefined
  /**
   * Applies a change where the id lives. The gallery record is held with the
   * local extras; a fork or an edited demo conversation lands there too.
   */
  readonly upsertLocal: (change: (current: readonly Conversation[]) => readonly Conversation[]) => void
}): LegacyTurns {
  const { status, modelId, markRunning, findConversation, upsertLocal } = options
  const demo = useDemoTurn()

  const run = useCallback(
    (conversationId: string, turnOptions: TurnRun) => {
      if (conversationId !== GALLERY_CONVERSATION_ID) return
      demo.run(turnOptions)
    },
    [demo.run],
  )

  const cancel = useCallback(() => {
    demo.cancel()
  }, [demo.cancel])

  const patch = useCallback(
    (id: string, change: (conversation: Conversation) => Conversation) => {
      upsertLocal((current) =>
        current.map((conversation) => (conversation.id === id ? change(conversation) : conversation)),
      )
    },
    [upsertLocal],
  )

  const send = useCallback(
    (conversationId: string | null, text: string): string => {
      const body = text.trim()
      if (!body) return conversationId ?? ''

      // Sending into an existing conversation is only ever the gallery here;
      // anything else would be a demo turn wearing a real conversation's id.
      if (conversationId !== GALLERY_CONVERSATION_ID) return conversationId ?? ''

      const userMessage: Message = {
        id: newId('msg'),
        role: 'user',
        text: body,
        createdAt: Date.now(),
      }
      patch(conversationId, (conversation) => ({
        ...conversation,
        title: conversation.title,
        messages: [...conversation.messages, userMessage],
        updatedAt: Date.now(),
      }))
      run(conversationId, {
        modelId: modelId(),
        patch: (change) => patch(conversationId, change),
        onThinking: () => {
          status('thinking')
          markRunning(conversationId, true)
        },
        onStreaming: () => status('streaming'),
        onDone: () => {
          status('idle')
          markRunning(conversationId, false)
        },
      })
      return conversationId
    },
    [markRunning, modelId, patch, run, status],
  )

  const retry = useCallback(
    (conversationId: string) => {
      if (conversationId !== GALLERY_CONVERSATION_ID) return
      cancel()
      const conversation = findConversation(conversationId)
      if (!conversation) return

      const kept = [...conversation.messages]
      while (kept.length > 0 && kept[kept.length - 1]?.role === 'assistant') kept.pop()
      if (kept.length === 0) return

      patch(conversationId, (current) => ({ ...current, messages: kept }))
      run(conversationId, {
        modelId: modelId(),
        patch: (change) => patch(conversationId, change),
        onThinking: () => {
          status('thinking')
          markRunning(conversationId, true)
        },
        onStreaming: () => status('streaming'),
        onDone: () => {
          status('idle')
          markRunning(conversationId, false)
        },
      })
    },
    [cancel, findConversation, markRunning, modelId, patch, run, status],
  )

  const editMessage = useCallback(
    (conversationId: string, messageId: string, text: string) => {
      if (conversationId !== GALLERY_CONVERSATION_ID) return
      const body = text.trim()
      if (!body) return
      cancel()

      const conversation = findConversation(conversationId)
      if (!conversation) return
      const index = conversation.messages.findIndex((message) => message.id === messageId)
      if (index < 0) return

      const kept = conversation.messages
        .slice(0, index + 1)
        .map((message) => (message.id === messageId ? { ...message, text: body } : message))

      patch(conversationId, (current) => ({
        ...current,
        messages: kept,
        updatedAt: Date.now(),
      }))
      run(conversationId, {
        modelId: modelId(),
        patch: (change) => patch(conversationId, change),
        onThinking: () => {
          status('thinking')
          markRunning(conversationId, true)
        },
        onStreaming: () => status('streaming'),
        onDone: () => {
          status('idle')
          markRunning(conversationId, false)
        },
      })
    },
    [cancel, findConversation, markRunning, modelId, patch, run, status],
  )

  const fork = useCallback(
    (conversationId: string, messageId: string): string | null => {
      if (conversationId !== GALLERY_CONVERSATION_ID) return null
      const conversation = findConversation(conversationId)
      if (!conversation) return null
      const index = conversation.messages.findIndex((message) => message.id === messageId)
      if (index < 0) return null

      // The id is minted before the state update, not inside it: an updater
      // must be pure, and React may call it twice under StrictMode.
      const copyId = newId('cnv')
      const copy: Conversation = {
        ...conversation,
        id: copyId,
        title: conversation.title ? `${conversation.title} (fork)` : null,
        messages: conversation.messages.slice(0, index + 1).map((message) => ({
          ...message,
          id: newId('msg'),
        })),
        updatedAt: Date.now(),
        pinned: false,
      }
      upsertLocal((current) => [copy, ...current])
      return copyId
    },
    [findConversation, upsertLocal],
  )

  return { run, cancel, send, retry, editMessage, fork }
}
