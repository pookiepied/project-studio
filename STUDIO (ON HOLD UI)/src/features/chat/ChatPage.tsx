import { useRef } from 'react'
import { StudioMark } from '@/components/brand/StudioMark'
import { Composer } from '@/features/chat/composer/Composer'
import { useChatSession } from '@/features/chat/session/useChatSession'
import { ScrollToLatest } from '@/features/chat/transcript/ScrollToLatest'
import { Transcript } from '@/features/chat/transcript/Transcript'

/**
 * Composition root for the chat surface: a scrolling transcript under a docked
 * composer. It wires children and owns nothing — conversation state lives
 * behind `useChatSession`, draft state lives in the composer.
 *
 * The transcript is the only scroll region here. The composer sits outside it
 * so it stays put no matter how far the conversation is scrolled.
 *
 * The dock is layered *over* the transcript rather than stacked beneath it, so
 * text passes behind the composer instead of stopping at a hard edge. A
 * gradient mask above it does the fade. Two consequences worth stating: the
 * transcript needs bottom padding equal to the dock's height (nothing else
 * reserves that space), and the mask must not intercept pointer events or the
 * bottom of the conversation becomes unclickable.
 */
export default function ChatPage() {
  const { messages, status, error, send, stop } = useChatSession()
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          {/* pb-32 clears the docked composer. */}
          <div className="mx-auto w-full max-w-3xl min-w-0 px-6 pt-8 pb-32">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <Transcript messages={messages} status={status} />
            )}
          </div>
        </div>

        <ScrollToLatest scrollRef={scrollRef} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        {/* The fade. `to transparent` in the same surface colour, so the
            transcript dissolves into the dock rather than sliding under a
            visible band. */}
        <div
          aria-hidden
          className="h-10 bg-gradient-to-b from-transparent to-surface"
        />
        <div className="pointer-events-auto bg-surface pb-5">
          <div className="mx-auto w-full max-w-3xl px-6">
            {error && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Composer status={status} onSend={send} onStop={stop} />
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <StudioMark size={40} className="text-foreground/80" />
      <p className="text-[13px] text-muted-foreground">What are we working on?</p>
    </div>
  )
}
