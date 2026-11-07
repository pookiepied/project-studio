import type { ToolCallView } from '@/features/chat/transcript/projection'
import { MediaCallArtifact } from './MediaCallArtifact'
import { QuestionAnswers } from './QuestionAnswers'
import { readMediaCall } from './mediaCall'
import { toolPresentation } from './toolPresentation'

export function ToolArtifact({ call, conversationId, live = false, textBefore = false, textAfter = false, rowBefore = false }: {
  call: ToolCallView
  conversationId: string
  /** The turn is live, so a row arriving now takes the house entrance. */
  live?: boolean
  /** Words stand directly above or below; a row slot takes a tool row's margin. */
  textBefore?: boolean
  textAfter?: boolean
  /** Another row stands directly above, so a row slot takes the one row gap. */
  rowBefore?: boolean
}) {
  const artifact = toolPresentation(call.toolName).artifact
  if (artifact === 'answers') {
    return <QuestionAnswers call={call} live={live} textBefore={textBefore} textAfter={textAfter} rowBefore={rowBefore} />
  }
  if (artifact !== 'media') return null
  const view = readMediaCall(call)
  return view === null ? null : <MediaCallArtifact call={call} view={view} conversationId={conversationId} />
}
