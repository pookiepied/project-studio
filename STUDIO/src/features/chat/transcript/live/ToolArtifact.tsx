import type { ToolCallView } from '@/features/chat/transcript/projection'
import { MediaCallArtifact } from './MediaCallArtifact'
import { readMediaCall } from './mediaCall'
import { toolPresentation } from './toolPresentation'

export function ToolArtifact({ call, conversationId }: { call: ToolCallView; conversationId: string }) {
  if (toolPresentation(call.toolName).artifact !== 'media') return null
  const view = readMediaCall(call)
  return view === null ? null : <MediaCallArtifact call={call} view={view} conversationId={conversationId} />
}
