import { useCallback } from 'react'

import { Composer } from '@/features/chat/composer/Composer'
import { useFirstTurn } from '@/features/chat/first-turn'
import { SendRefusal } from '@/features/chat/transcript/live/ConnectionNotice'
import { effectiveTurnSettings } from '@/domain/session/settings'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'

/**
 * The composer that starts a conversation, wherever one can be started.
 *
 * Home and a project page differ in exactly two things — which project the
 * conversation belongs to and what the field says when empty — and everything
 * else about starting a conversation is identical: admit the turn, record the
 * conversation the harness now owns, open it, and on a refusal create nothing
 * and say why above the field. That behaviour was written out twice, once per
 * page, which is how the two copies start disagreeing; a page should say
 * WHICH surface it is, not re-explain what starting a conversation means.
 *
 * The order is the part worth protecting, and it is the reason this is a
 * component rather than a hook returning pieces: nothing exists until the
 * harness has taken the message, so there is no arrangement of these three
 * steps a caller can get wrong by holding them separately.
 */
export function StartConversation({
  projectId,
  placeholder,
}: {
  /** The project a conversation started here belongs to, or null on home. */
  projectId: string | null
  placeholder: string
}) {
  const { beginConversation, settings } = useWorkspace()
  const { openChat } = useNavigation()

  const onStarted = useCallback(
    (conversationId: string, text: string) => {
      beginConversation({
        id: conversationId,
        firstMessage: text,
        projectId,
        // The settings the turn went out with, so the record and the
        // admission path's own write describe the same conversation.
        settings: effectiveTurnSettings(null, settings),
      })
      openChat(conversationId)
    },
    [beginConversation, openChat, projectId, settings],
  )
  // Read at send time, not captured: a model picked between mounting and
  // sending is the one the turn should use.
  const firstTurn = useFirstTurn({
    onStarted,
    settings: () => effectiveTurnSettings(null, settings),
  })

  return (
    <>
      {firstTurn.refused !== null ? (
        <SendRefusal failure={firstTurn.refused} onDismiss={firstTurn.dismissRefusal} />
      ) : null}

      <Composer
        conversationId={null}
        placeholder={placeholder}
        onSend={firstTurn.start}
      />
    </>
  )
}
