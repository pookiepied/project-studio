import { useCallback, useState } from 'react'

import { visionRefusal } from '@/domain/attachments/images'
import { Composer } from '@/features/chat/composer/Composer'
import { useFirstTurn } from '@/features/chat/connection/first-turn'
import { rememberFirstAdmission } from '@/features/chat/connection/first-attach'
import { useVoiceModeContext } from '@/features/voice'
import { newId } from '@/lib/id'
import { SendRefusal } from '@/features/chat/transcript/live/ConnectionNotice'
import { effectiveTurnSettings } from '@/domain/turn/settings'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { turnSettingsToWire } from '@/platform/harness'
import type { SeamFailure, TurnImageWire } from '@/platform/harness'

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
  const { beginConversation, settings, catalog } = useWorkspace()
  const { openChat } = useNavigation()

  const onStarted = useCallback(
    (conversationId: string, text: string) => {
      beginConversation({
        id: conversationId,
        firstMessage: text,
        projectId,
        // The settings the turn went out with, so the record and the
        // admission path's own write describe the same conversation - the
        // mode included, which the harness holds per conversation.
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
    // The project rides with the send, not with the index write that follows
    // it. A first turn is submitted before the conversation row exists, so
    // without this the run that answers it has no project to read and stands
    // in the conversation's own scratch directory - with the project open on
    // screen the whole time.
    settings: () => turnSettingsToWire(effectiveTurnSettings(null, settings), projectId),
  })

  // Voice from an empty page: the id is minted now, but nothing exists until
  // the first utterance is admitted - then the conversation is recorded and
  // opened exactly as a typed first turn's would be. Leaving without speaking
  // leaves nothing behind.
  const voice = useVoiceModeContext()
  const onStartVoice = useCallback(() => {
    const conversationId = newId('cnv')
    voice.enter(conversationId, {
      settings: turnSettingsToWire(effectiveTurnSettings(null, settings), projectId),
      onAdmitted: (text, receipt) => {
        rememberFirstAdmission(conversationId, { offset: receipt.offset, submissionId: receipt.submissionId, text })
        onStarted(conversationId, text)
      },
    })
  }, [onStarted, projectId, settings, voice])

  /** The send-time refusal for images a blind model cannot take. */
  const [attachRefusal, setAttachRefusal] = useState<SeamFailure | null>(null)

  const onSend = useCallback(
    async (text: string, images: readonly TurnImageWire[], documents: readonly File[]) => {
      const refusal = visionRefusal(
        effectiveTurnSettings(null, settings).modelId,
        images.length,
        catalog.models,
      )
      if (refusal !== null) {
        setAttachRefusal(refusal)
        return { ok: false }
      }
      setAttachRefusal(null)
      return firstTurn.start(text, images, documents)
    },
    // The method, not the object: only `start` is called, and `firstTurn`
    // is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.models, firstTurn.start, settings],
  )

  return (
    <>
      {firstTurn.refused !== null ? (
        <SendRefusal failure={firstTurn.refused} onDismiss={firstTurn.dismissRefusal} />
      ) : null}
      {attachRefusal !== null ? (
        <SendRefusal failure={attachRefusal} onDismiss={() => setAttachRefusal(null)} />
      ) : null}

      <Composer
        conversationId={null}
        placeholder={placeholder}
        onSend={onSend}
        onStartVoice={onStartVoice}
      />
    </>
  )
}
