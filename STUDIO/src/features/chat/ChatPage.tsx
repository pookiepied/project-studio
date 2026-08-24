import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Composer } from '@/features/chat/composer'
import { Transcript, useAutoScroll } from '@/features/chat/transcript'
import { ConnectionNotice } from '@/features/chat/transcript/live/ConnectionNotice'
import { LiveTranscript } from '@/features/chat/transcript/live/LiveTranscript'
import { useConversationTranscript } from '@/features/chat/useConversationTranscript'
import { GALLERY_CONVERSATION_ID } from '@/domain/session/gallery'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/session/types'

/**
 * A conversation: a scrolling transcript with the composer beneath it.
 *
 * The composer is the same component and the same measure as on home, so
 * sending the first message moves the field up the screen rather than replacing
 * it with a different one. Nothing about the control changes -- only its
 * position -- which makes the transition read as the room rearranging rather
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
 * two projections of one log here, never derived from each other -- nothing
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
  const { status, retry, editMessage, fork } = useWorkspace()
  const { openChat } = useNavigation()
  const gallery = conversation.id === GALLERY_CONVERSATION_ID

  const live = useConversationTranscript(conversation.id)
  const { viewport, pinned, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom } =
    useAutoScroll(gallery ? conversation.messages : live.items)

  const forkFrom = (messageId: string) => {
    const created = fork(conversation.id, messageId)
    if (created) (onForked ?? openChat)(created)
  }

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
              onRetry={() => retry(conversation.id)}
              onEdit={(messageId, text) => editMessage(conversation.id, messageId, text)}
              onFork={forkFrom}
            />
          ) : (
            <LiveTranscript items={live.items} phase={live.phase} viewport={viewport} />
          )}
        </div>
      </div>

      {/* `pointer-events-none` matters: a gradient laid over the transcript
          that swallowed clicks would silently make the last line of a reply
          unselectable. */}
      {/* Solid for the strip's own height, then a short fade below it.

          It used to be one gradient the whole way down, which meant the band
          holding the identity line was already partly transparent -- so a line
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
            field's upper edge -- the composer's outline is a 1px ring in its
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
              <Icons.jumpToLatest className="text-muted-foreground" />
            </motion.button>
          ) : null}
        </AnimatePresence>

        <div
          className="relative z-10 mx-auto w-full bg-surface pb-4"
          style={{ maxWidth: SHELL.measure, paddingInline: SHELL.gutter }}
        >
          {!gallery ? (
            <ConnectionNotice phase={live.phase} onResume={live.resume} />
          ) : null}

          <Composer
            conversationId={conversation.id}
            projectId={conversation.projectId}
            placeholder="Reply"
            {...(gallery
              ? {}
              : {
                  onSend: (text: string) => void live.submit(text),
                  busy: live.phase.status === 'streaming',
                  onStop: () => void live.abort(),
                })}
          />
        </div>
      </div>
    </div>
  )
}
