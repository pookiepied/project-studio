import type { RecordedChange } from './recordedChanges'
import { ToolGroups } from '@/features/chat/transcript/live/ToolGroups'

export function ChangesPanel({ changes, conversationId }: { changes: readonly RecordedChange[]; conversationId: string }) {
  return <div className="flex min-w-0 flex-col gap-5 text-foreground">
    <p className="text-caption text-muted-foreground">File tool changes recorded in this turn. Expand an operation to review its contents.</p>
    {changes.map((change) => <section key={change.path} aria-label={`Changes to ${change.path}`} className="min-w-0">
      <h3 className="mb-1 break-all text-ui font-medium">{change.path}</h3>
      <p className="mb-2 text-caption text-muted-foreground">{change.action}</p>
      <ToolGroups conversationId={conversationId} groups={change.calls.map((call) => ({ id: call.toolCallId, file: change.path, calls: [call] }))} />
    </section>)}
  </div>
}
