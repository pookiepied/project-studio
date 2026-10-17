import { isRecord } from '@/lib/guards'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { netOf } from '@/features/chat/transcript/live/groupNet'
import type { LineDiff } from '@/features/chat/transcript/live/diffLines'
import { resultState } from '@/features/chat/transcript/live/toolResult'

export interface RecordedChange {
  readonly path: string
  readonly action: 'Created' | 'Edited' | 'Moved' | 'Deleted'
  readonly calls: readonly ToolCallView[]
  /** Only shown when the recorded edits prove a net comparison. */
  readonly diff: LineDiff | null
}

/** Review the file tools' receipts, not the current disk or unrelated Git edits. */
export function recordedChanges(calls: readonly ToolCallView[]): RecordedChange[] {
  const paths = new Map<string, RecordedChange>()
  for (const call of calls) {
    if (!call.output?.present || resultState(call) !== 'success' || !call.input?.present || !isRecord(call.input.value)) continue
    if (!['edit', 'write', 'move', 'delete'].includes(call.toolName)) continue
    const input = call.input.value
    const path = call.toolName === 'move' ? input['to'] : input['path'] ?? input['file_path']
    if (typeof path !== 'string' || path.trim() === '') continue
    const previousPath = call.toolName === 'move' && typeof input['from'] === 'string' ? input['from'] : path
    const previous = paths.get(previousPath)
    const edits = [...(previous?.calls ?? []), call]
    if (previousPath !== path) paths.delete(previousPath)
    const output: unknown = call.output.value
    const created = call.toolName === 'write' && typeof output === 'string' && output.startsWith('Created ')
    const action = call.toolName === 'delete' ? 'Deleted' : call.toolName === 'move' ? 'Moved'
      : created || previous?.action === 'Created' ? 'Created' : 'Edited'
    paths.set(path, { path, action, calls: edits,
      diff: action === 'Deleted' || action === 'Moved' ? null : netOf(edits) })
  }
  return [...paths.values()]
}
