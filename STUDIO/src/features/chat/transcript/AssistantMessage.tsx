import { useState } from 'react'
import { Icons } from '@/components/icons'
import { findModel } from '@/domain/models/catalog'
import { StreamedMarkdown, useSmoothText } from '@/features/chat/streaming'
import { MessageActions } from '@/features/chat/transcript/MessageActions'
import { ThinkingBlock } from '@/features/chat/transcript/ThinkingBlock'
import type { Message } from '@/domain/session/types'

/**
 * What came back: full measure, flush left, no container.
 *
 * No avatar and no name. There are two participants and the alignment already
 * says which is which, so a mark beside every reply is a column of repeated
 * decoration that pushes the text it labels 28px to the right for no gain.
 *
 * The model name sits under the reply rather than above it, in the action row.
 * Above, it is a header you read before every answer; below, it is available
 * the moment you think to ask which model said this — which is afterwards.
 */
export function AssistantMessage({
  message,
  streaming,
  onRetry,
  onFork,
}: {
  message: Message
  /** This is the message currently being written. */
  streaming: boolean
  onRetry: () => void
  onFork: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const model = message.modelId ? findModel(message.modelId) : undefined
  const shown = useSmoothText(message.text, streaming)
  const revealing = shown.length < message.text.length

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex min-w-0 flex-col"
    >
      {message.thinking ? (
        <ThinkingBlock thinking={message.thinking} live={streaming && shown.length === 0} />
      ) : null}

      {/* The text on screen is not `message.text`. It is a prefix of it, paced
          by `useSmoothText` off the rate the stream is actually arriving at, so
          a model producing 900 tokens a second and one producing 25 both read
          as a steady line of writing rather than as bursts and pauses.

          `revealing` is the tail of that: the transport can finish while the
          reveal is still a sentence behind, and the block must go on being
          treated as live until the last character is out, or it would settle
          and re-render mid-sentence. */}
      <div className="studio-prose min-w-0">
        <StreamedMarkdown text={shown} streaming={streaming || revealing} />
        {streaming || revealing ? <StreamingCaret /> : null}
      </div>

      {/* Always mounted, never conditional — and this is the fix for the jump
          at the end of a reply.

          It used to be `{streaming ? null : <MessageActions/>}`. So the instant
          the response finished, a 24px row plus 12px above and 16px below
          appeared out of nothing, and every pixel of the conversation above it
          moved. That is the "flash" and the bubble "leaching" at the exact
          moment a response lands: nothing was flickering, the whole transcript
          was being shoved by a row arriving late.

          `MessageActions` already promises to hold its height while hidden and
          fade rather than mount — this component was the one place breaking
          that promise. Now the space is reserved from the first frame of the
          reply, so when the row appears nothing else moves. `visible` still
          gates it, so a message being written offers no retry button. */}
      <MessageActions
          visible={hovered && !streaming && !revealing}
          copyPayload={message.text}
          actions={[
            { id: 'retry', label: 'Try again', icon: Icons.retry, run: onRetry },
            { id: 'fork', label: 'Branch from here', icon: Icons.fork, run: onFork },
            { id: 'read', label: 'Read aloud', icon: Icons.readAloud, run: () => undefined },
          ]}
          // Inside the row, not beside it. As a sibling it missed the row's top
          // margin and floated 12px above the buttons it names.
          trailing={
            model ? <span className="text-caption text-muted-foreground">{model.name}</span> : null
          }
        />
    </div>
  )
}

/**
 * The caret that trails streaming text.
 *
 * `inline-block` with a zero-width space rather than a positioned element, so
 * it sits at the end of the last line wherever that happens to be, including
 * mid-paragraph and after a list item.
 */
function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-foreground/70 align-baseline"
    />
  )
}
