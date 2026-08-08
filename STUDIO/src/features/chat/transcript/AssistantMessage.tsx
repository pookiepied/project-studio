import { Markdown } from '@/features/chat/transcript/markdown/Markdown'
import { StreamingCursor } from '@/features/chat/streaming/StreamingCursor'
import { ThinkingBlock } from '@/features/chat/transcript/ThinkingBlock'
import type { ChatMessage } from '@/features/chat/session/types'

/**
 * A message from the assistant: reasoning first, then the answer as prose.
 *
 * No bubble — it runs inline in the column at full width, which is what long
 * output with headings, lists and code needs. `min-w-0` on the container is
 * what lets the code blocks inside actually scroll rather than stretching the
 * transcript.
 */
export function AssistantMessage({
  message,
  streaming,
  thinking,
}: {
  message: ChatMessage
  streaming: boolean
  thinking: boolean
}) {
  const reasoning = message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('\n')

  const answer = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  return (
    <div className="min-w-0">
      {reasoning && <ThinkingBlock text={reasoning} active={thinking} />}

      {answer && (
        <div className="min-w-0">
          <Markdown>{answer}</Markdown>
        </div>
      )}

      {streaming && !answer && <StreamingCursor />}
    </div>
  )
}
