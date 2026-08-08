import { useRef } from 'react'
import { StudioMark } from '@/components/brand/StudioMark'
import { Composer } from '@/features/chat/composer/Composer'
import { useChatSession } from '@/features/chat/session/useChatSession'
import { ScrollToLatest } from '@/features/chat/transcript/ScrollToLatest'
import { Transcript } from '@/features/chat/transcript/Transcript'

/**
 * Composition root for the chat surface: a scrolling transcript over a docked
 * composer. It wires children and owns nothing — conversation state lives
 * behind `useChatSession`, draft state lives in the composer.
 *
 * The transcript is the only scroll region here. The composer sits outside it
 * so it stays put no matter how far the conversation is scrolled.
 */
export default function ChatPage() {
  const { messages, status, error, send, stop } = useChatSession()
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl min-w-0 px-6 pt-10 pb-6">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <Transcript messages={messages} status={status} />
            )}
          </div>
        </div>

        <ScrollToLatest scrollRef={scrollRef} />
      </div>

      <div className="shrink-0">
        <div className="mx-auto w-full max-w-3xl px-6 pb-5">
          {error && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Composer status={status} onSend={send} onStop={stop} />
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <StudioMark size={44} className="text-foreground" />
      <p className="text-sm text-muted-foreground">What are we working on?</p>
    </div>
  )
}
