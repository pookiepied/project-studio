import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { visionRefusal } from '@/domain/attachments/images'
import { Composer } from '@/features/chat/composer'
import { useForkConversation } from '@/features/chat/fork'
import { Transcript, useAutoScroll } from '@/features/chat/transcript'
import { ConnectionNotice, SendRefusal } from '@/features/chat/transcript/live/ConnectionNotice'
import { LiveTranscript } from '@/features/chat/transcript/live/LiveTranscript'
import { useConversationTranscript } from '@/features/chat/useConversationTranscript'
import { isTurnRunning } from '@/features/chat/useConversation'
import { GALLERY_CONVERSATION_ID } from '@/domain/session/gallery'
import { effectiveTurnSettings } from '@/domain/session/settings'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { SeamFailure, TurnImageWire } from '@/platform/harness'
import type { Conversation } from '@/domain/session/types'

/**
 * A conversation: a scrolling transcript with the composer beneath it.
 *
 * The composer is the same component and the same measure as on home, so
 * sending the first message moves the field up the screen rather than replacing
 * it with a different one. Nothing about the control changes — only its
 * position — which makes the transition read as the room rearranging rather
 * than as a new page.
 *
 * Both ends fade into the surface instead of meeting a bar. The strip above and
 * the composer below paint no fill, so a gradient is what separates them from
 * the text scrolling past, and `studio-scroll-inset` keeps the scroll thumb out
 * from under those gradients.
 *
 * ---- Where the words come from --------------------------------------------
 *
 * Every ordinary conversation renders LIVE: the transcript is a projection of
 * the harness's event stream (`useConversationTranscript`), and the composer
 * submits to the harness. What the UI shows and what the model receives are
 * two projections of one log here, never derived from each other — nothing
 * in the live path reads rendered state to build a request.
 *
 * The artifact gallery is the one exception: its replies are a local demo of
 * stages no harness produces, so it keeps the seeded transcript it has always
 * had. That is a display of artifacts, not a conversation with an agent.
 */
export function ChatPage({
  conversation,
  onForked,
}: {
  conversation: Conversation
  /**
   * Where a fork opens. The default navigates in place, which is right in the
   * studio; a detached window has no navigation to move, so it passes its own
   * and gives the fork a window of its own instead.
   */
  onForked?: (conversationId: string) => void
}) {
  const { status, fork, touch, settings, catalog, markRunning } = useWorkspace()
  const { openChat } = useNavigation()
  const gallery = conversation.id === GALLERY_CONVERSATION_ID

  const live = useConversationTranscript(conversation.id)

  // The sidebar's working mark is only as honest as its witness, and for a
  // real turn this page is the only one there is: the phase machine here is
  // what saw the admission (the receipt) and what sees the settlement (the
  // wire). While it reports submitted or streaming, the conversation is
  // working -- including when this page is not the one on screen, which is
  // the only question the sidebar asks. Unmount clears nothing: a turn
  // outlives the view that watches it (ADR 0045), so the mark persists until
  // a witness -- this one on return, another window's -- sees it settle.
  // `interrupted` clears it, though the run may technically live on: a mark
  // with no witness behind it is the invented progress the mark exists to
  // refuse, and resuming re-marks it within one replay.
  useEffect(() => {
    if (gallery) return
    markRunning(conversation.id, isTurnRunning(live.phase))
  }, [gallery, conversation.id, live.phase.status, markRunning])
  const { viewport, pinned, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom } =
    useAutoScroll(gallery ? conversation.messages : live.items)

  // Branch from one answer: everything up to and including it becomes the
  // first message of a new conversation, named for its source.
  const { branchFrom } = useForkConversation()

  const forkFrom = (messageId: string) => {
    const created = fork(conversation.id, messageId)
    if (created) (onForked ?? openChat)(created)
  }

  /**
   * A refusal the send path raises before the POST: the turn is addressed to
   * a model that cannot see, and it is carrying images. Held here, beside the
   * connection notices, because it is a send the composer kept — the words
   * and the strip stay, and the sentence explains why nothing left.
   */
  const [attachRefusal, setAttachRefusal] = useState<SeamFailure | null>(null)

  /**
   * A receipt is also a recency fact: the index stamps the conversation the
   * moment the harness admits a later turn, so sorting survives a reload.
   * The turn goes out with this conversation's settled settings - the row's
   * choice when it has one, the window's otherwise - the same derivation the
   * picker displays, so what is on screen is what is sent.
   */
  const sendTurn = useCallback(
    async (text: string, images: readonly TurnImageWire[]) => {
      const effective = effectiveTurnSettings(conversation, settings)
      const refused = visionRefusal(effective.modelId, images.length, catalog.models)
      if (refused !== null) {
        setAttachRefusal(refused)
        return { ok: false }
      }
      setAttachRefusal(null)
      const sent = await live.submit(text, effective, images)
      if (sent.ok) touch(conversation.id)
      return sent
    },
    [conversation, catalog.models, live.submit, settings, touch],
  )

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={viewport}
        onScroll={onScroll}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        // Paging and arrowing are scrolling too. Without this the keyboard was
        // the one way to leave the bottom that the follow would silently undo.
        onKeyDown={onKeyDown}
        className="studio-scroll-inset studio-no-anchor min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className="mx-auto w-full"
          style={{
            maxWidth: SHELL.measure,
            paddingInline: SHELL.gutter,
            paddingTop: SHELL.topStrip.height + 20,
            paddingBottom: 20,
          }}
        >
          {gallery ? (
            <Transcript
              conversation={conversation}
              status={status}
              viewport={viewport}
              onFork={forkFrom}
            />
          ) : (
            <LiveTranscript
              items={live.items}
              pending={live.pending}
              phase={live.phase}
              viewport={viewport}
              onBranch={(messageId) => void branchFrom(conversation, live.items, messageId)}
            />
          )}
        </div>
      </div>

      {/* `pointer-events-none` matters: a gradient laid over the transcript
          that swallowed clicks would silently make the last line of a reply
          unselectable. */}
      {/* Solid for the strip's own height, then a short fade below it.

          It used to be one gradient the whole way down, which meant the band
          holding the identity line was already partly transparent — so a line
          of the transcript sliding underneath showed *through* the project
          name and branch. Two pieces of text occupying the same pixels is not
          a soft edge, it is a collision, and it is worst exactly when the page
          is moving and the eye is trying to read the title.

          The fade still exists; it just starts where the chrome ends. Below
          the strip there is nothing to protect, so text can dissolve into the
          surface the way it should. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-surface"
        style={{ height: SHELL.topStrip.height }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 z-20 h-5 bg-gradient-to-b from-surface to-transparent"
        style={{ top: SHELL.topStrip.height }}
      />

      <div className="relative shrink-0">
        {/* Behind the composer, not over it.

            Without the stacking order stated, the fade painted on top of the
            field's upper edge — the composer's outline is a 1px ring in its
            box-shadow, and a gradient laid over it ate the top of that ring.
            The field looked like it had three sides. The fade's job is to
            dissolve the *transcript*, so it belongs under everything the
            composer draws. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-full z-0 h-10 bg-gradient-to-t from-surface to-transparent"
        />

        {/* Only offered once the reader has scrolled away. Shown permanently it
            is a button that does nothing most of the time. */}
        <AnimatePresence>
          {!pinned ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              onClick={scrollToBottom}
              aria-label="Jump to latest"
              className="studio-blur absolute -top-14 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border shadow-lifted"
            >
              <Icons.jumpToLatest />
            </motion.button>
          ) : null}
        </AnimatePresence>

        <div
          className="relative z-10 mx-auto w-full bg-surface pb-4"
          style={{ maxWidth: SHELL.measure, paddingInline: SHELL.gutter }}
        >
          {!gallery ? (
            <>
              <ConnectionNotice
                phase={live.phase}
                onResume={live.resume}
                refused={live.refused}
                onDismissRefusal={live.dismissRefusal}
              />
              {attachRefusal !== null ? (
                <SendRefusal failure={attachRefusal} onDismiss={() => setAttachRefusal(null)} />
              ) : null}
            </>
          ) : null}

          <Composer
            conversationId={conversation.id}
            placeholder="Reply"
            {...(gallery
              ? {}
              : {
                  onSend: sendTurn,
                  // Admitted counts. A turn the harness has taken but not yet
                  // started producing is still a turn: the words are gone,
                  // the stop control is the only thing that can call it back,
                  // and on the real provider that window has been most of the
                  // turn's length. Reading `streaming` alone is what left the
                  // composer idle for six of a seven-second turn.
                  busy: isTurnRunning(live.phase),
                  onStop: () => void live.abort(),
                })}
          />
        </div>
      </div>
    </div>
  )
}
