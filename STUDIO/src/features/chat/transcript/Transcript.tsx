import { AssistantMessage } from '@/features/chat/transcript/AssistantMessage'
import { UserBubble } from '@/features/chat/transcript/UserBubble'
import type { ChatMessage, ChatStatus } from '@/features/chat/session/types'

/**
 * The conversation, oldest first.
 *
 * Deliberately no auto-scroll. The previous chat followed the tail while the
 * model wrote, which fought the user whenever they scrolled up to read
 * something — the view kept yanking back down. Scroll position stays the
 * user's until we implement following properly, with a "jump to latest"
 * affordance and a rule that following stops the moment they scroll away.
 */
export function Transcript({
  messages,
  status,
}: {
  messages: readonly ChatMessage[]
  status: ChatStatus
}) {
  const lastId = messages.at(-1)?.id

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {messages.map((message) => {
        const isLast = message.id === lastId
        return (
          <article key={message.id} className="min-w-0">
            <span className="sr-only">{message.role === 'user' ? 'You' : 'STUDIO'}: </span>
            {message.role === 'user' ? (
              <UserBubble
                text={message.parts
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('')}
              />
            ) : (
              <AssistantMessage
                message={message}
                streaming={isLast && status === 'streaming'}
                thinking={isLast && status === 'thinking'}
              />
            )}
          </article>
        )
      })}
    </div>
  )
}
