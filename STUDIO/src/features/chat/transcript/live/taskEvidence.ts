import type { AssistantSegment, ToolCallView } from '@/features/chat/transcript/projection'
import { recordedChanges } from '@/features/changes/recordedChanges'
import { readMediaCall } from './mediaCall'
import { resultState } from './toolResult'

export function callsIn(segments: readonly AssistantSegment[]): ToolCallView[] {
  return segments.flatMap((segment) => segment.kind === 'tools' ? segment.groups.flatMap((group) => group.calls) : [])
}

/**
 * A tool-assisted conversation is not automatically a completed task.
 * Require a produced result: recorded file changes or generated artifacts.
 * Reading, thinking, commands, browsing, plans and delegation alone do not
 * establish that distinction, however many calls or minutes they took.
 */
export function hasTaskResult(calls: readonly ToolCallView[]): boolean {
  return recordedChanges(calls).length > 0 || calls.some((call) =>
    resultState(call) === 'success' && (readMediaCall(call)?.artifacts.length ?? 0) > 0)
}
