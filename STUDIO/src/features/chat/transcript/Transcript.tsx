import { StudioMark } from '@/components/brand'
import { AssistantMessage } from '@/features/chat/transcript/AssistantMessage'
import { UserMessage } from '@/features/chat/transcript/UserMessage'
import type { Conversation, SessionStatus } from '@/domain/session/types'

/**
 * The list of turns.
 *
 * Deliberately thin: it decides which component a message gets and nothing
 * else. Every behaviour that used to accumulate in a transcript component --
 * collapsing, editing, hover actions, code, math, the reasoning trace -- lives
 * in the component that owns it, so this file stays readable as those grow.
 */
export function Transcript({
  conversation,
  status,
  onRetry,
  onEdit,
  onFork,
}: {
  conversation: Conversation
  status: SessionStatus
  onRetry: () => void
  onEdit: (messageId: string, text: string) => void
  onFork: (messageId: string) => void
}) {
  const lastId = conversation.messages[conversation.messages.length - 1]?.id

  return (
    <div className="flex flex-col gap-6">
      {conversation.messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage
            key={message.id}
            message={message}
            onEdit={(text) => onEdit(message.id, text)}
          />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            streaming={status !== 'idle' && message.id === lastId}
            onRetry={onRetry}
            onFork={() => onFork(message.id)}
          />
        ),
      )}

      {/* The gap between sending and the first token. The mark's own ripple and
          nothing else -- no "Thinking..." label, because the glyph already
          animates and a word beside it is the interface narrating something the
          user can see. */}
      {status === 'thinking' && conversation.messages[conversation.messages.length - 1]?.role === 'user' ? (
        <StudioMark busy size={15} className="text-foreground/45" />
      ) : null}
    </div>
  )
}
