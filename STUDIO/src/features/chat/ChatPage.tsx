import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Composer } from '@/features/chat/composer'
import { Transcript, useAutoScroll } from '@/features/chat/transcript'
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
 */
export function ChatPage({ conversation }: { conversation: Conversation }) {
  const { status, retry, editMessage, fork } = useWorkspace()
  const { openChat } = useNavigation()
  const { viewport, pinned, onScroll, onWheel, onPointerDown, scrollToBottom } = useAutoScroll(
    conversation.messages,
  )

  const forkFrom = (messageId: string) => {
    const created = fork(conversation.id, messageId)
    if (created) openChat(created)
  }

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={viewport}
        onScroll={onScroll}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        className="studio-scroll-inset min-h-0 flex-1 overflow-y-auto"
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
          <Transcript
            conversation={conversation}
            status={status}
            onRetry={() => retry(conversation.id)}
            onEdit={(messageId, text) => editMessage(conversation.id, messageId, text)}
            onFork={forkFrom}
          />
        </div>
      </div>

      {/* `pointer-events-none` matters: a gradient laid over the transcript
          that swallowed clicks would silently make the last line of a reply
          unselectable. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-surface via-surface/85 to-transparent"
        style={{ height: SHELL.topStrip.height + 14 }}
      />

      <div className="relative shrink-0">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-surface to-transparent"
        />

        {/* Only offered once the reader has scrolled away. Shown permanently it
            is a button that does nothing most of the time. */}
        <AnimatePresence>
          {!pinned ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              onClick={scrollToBottom}
              aria-label="Jump to latest"
              className="studio-blur absolute -top-9 left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border shadow-[0_4px_14px_-4px_rgba(0,0,0,0.24)]"
            >
              <Icons.jumpToLatest className="text-muted-foreground" />
            </motion.button>
          ) : null}
        </AnimatePresence>

        <div
          className="mx-auto w-full bg-surface pb-4"
          style={{ maxWidth: SHELL.measure, paddingInline: SHELL.gutter }}
        >
          <Composer
            conversationId={conversation.id}
            projectId={conversation.projectId}
            placeholder="Reply"
          />
        </div>
      </div>
    </div>
  )
}
