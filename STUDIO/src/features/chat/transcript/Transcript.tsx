import { StudioMark } from '@/components/brand'
import { EarlierBoundary, useTranscriptWindow } from '@/features/chat/transcript/paging'
import { AssistantMessage } from '@/features/chat/transcript/AssistantMessage'
import { UserMessage } from '@/features/chat/transcript/UserMessage'
import type { Conversation, SessionStatus } from '@/domain/session/types'

/**
 * The list of turns.
 *
 * Deliberately thin: it decides which component a message gets and nothing
 * else. Every behaviour that used to accumulate in a transcript component —
 * collapsing, hover actions, code, math, the reasoning trace — lives in the
 * component that owns it, so this file stays readable as those grow.
 */
export function Transcript({
  conversation,
  status,
  viewport,
  onFork,
}: {
  conversation: Conversation
  status: SessionStatus
  /** The scroll container, needed to hold position while paging older turns. */
  viewport: React.RefObject<HTMLElement | null>
  onFork: (messageId: string) => void
}) {
  const lastId = conversation.messages[conversation.messages.length - 1]?.id
  const { visible, hasOlder, loading, sentinel } = useTranscriptWindow(
    conversation.messages,
    viewport,
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Only when there is history behind the top of the list. On a short
          conversation this is absent entirely rather than being an empty
          boundary announcing that nothing came before. */}
      {hasOlder ? <EarlierBoundary loading={loading} ref={sentinel} /> : null}

      {visible.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            streaming={status !== 'idle' && message.id === lastId}
            // The raw callback: the message is memoized, and a fresh closure
            // per render would un-memoize every row. It carries the id.
            onFork={onFork}
          />
        ),
      )}

      {/* The gap between sending and the first token. The mark's own ripple and
          nothing else — no "Thinking..." label, because the glyph already
          animates and a word beside it is the interface narrating something the
          user can see. */}
      {status === 'thinking' && visible[visible.length - 1]?.role === 'user' ? (
        <StudioMark busy size={16} className="text-foreground/45" />
      ) : null}
    </div>
  )
}
