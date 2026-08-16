import { useState } from 'react'
import { Icons } from '@/components/icons'
import { findModel } from '@/domain/models/catalog'
import { Markdown } from '@/features/chat/markdown'
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
 * the moment you think to ask which model said this -- which is afterwards.
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

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="flex min-w-0 flex-col"
    >
      {message.thinking ? (
        <ThinkingBlock thinking={message.thinking} live={streaming && message.text.length === 0} />
      ) : null}

      <div className="studio-prose min-w-0">
        <Markdown text={message.text} />
        {streaming ? <StreamingCaret /> : null}
      </div>

      {/* No actions on a message still being written: retrying something that
          has not finished arriving is a request nobody means. */}
      {streaming ? null : (
        <div className="flex items-center gap-2">
          <MessageActions
            visible={hovered}
            copyPayload={message.text}
            actions={[
              { id: 'retry', label: 'Try again', icon: Icons.retry, run: onRetry },
              { id: 'fork', label: 'Branch from here', icon: Icons.fork, run: onFork },
              { id: 'read', label: 'Read aloud', icon: Icons.readAloud, run: () => undefined },
            ]}
          />
          {model && hovered ? (
            <span className="text-caption text-muted-foreground">{model.name}</span>
          ) : null}
        </div>
      )}
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
