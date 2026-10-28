import type { TranscriptItem, ToolCallView } from '@/features/chat/transcript/projection'
import { callsIn } from '@/features/chat/transcript/live/taskEvidence'
import { resultState } from '@/features/chat/transcript/live/toolResult'
import { familyOf } from '@/features/chat/transcript/live/reportFamily'

export type WorkspaceStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface WorkspaceTask {
  readonly id: string
  readonly conversationId: string
  readonly title: string
  readonly status: WorkspaceStatus
  readonly messages: readonly Extract<TranscriptItem, { kind: 'assistant' }>[]
  readonly calls: readonly ToolCallView[]
  readonly timestamp: string | null
  readonly failureReason?: string | null
}

/** Labels describe capability, never interpolate commands, paths or tool arguments. */
export function activityTitle(calls: readonly ToolCallView[]): string {
  const call = calls[calls.length - 1]
  if (!call) return 'Agent response'
  const family = familyOf(call.toolName)
  if (family) return family.id === 'computer' ? 'Working with your computer' : 'Exploring the browser'
  if (call.toolName === 'task') return 'Delegating work'
  if (['read', 'glob', 'grep'].includes(call.toolName)) return 'Analyzing project files'
  if (['edit', 'write', 'move', 'delete'].includes(call.toolName)) return 'Updating project files'
  if (['shell', 'jobs'].includes(call.toolName)) return 'Running project commands'
  if (call.toolName === 'plan') return 'Planning the work'
  if (['web_search', 'fetch'].includes(call.toolName)) return 'Researching the web'
  if (call.toolName.startsWith('studio_')) return 'Creating media'
  return 'Using connected tools'
}

/** Rebuilt from canonical history; replay cannot append duplicate executions. */
export function workspaceTasks(conversationId: string, items: readonly TranscriptItem[], running: boolean, activeSubmissionId: string | null = null): WorkspaceTask[] {
  const tasks = new Map<string, WorkspaceTask>()
  let timestamp: string | null = null
  for (const item of items) {
    if (item.kind === 'user') timestamp = item.timestamp
    if (item.kind === 'submission-failed') {
      const previous = tasks.get(item.submissionId)
      tasks.set(item.submissionId, { id: item.submissionId, conversationId, title: previous?.title ?? 'Agent response',
        messages: previous?.messages ?? [], calls: previous?.calls ?? [], timestamp: previous?.timestamp ?? timestamp,
        status: item.outcome === 'aborted' ? 'cancelled' : 'failed', failureReason: item.reason })
    }
    if (item.kind !== 'assistant') continue
    const id = item.submissionId ?? item.id
    const previous = tasks.get(id)
    const messages = [...(previous?.messages ?? []), item]
    const calls = messages.flatMap((message) => callsIn(message.segments))
    const status = item.end.state === 'failed' ? 'failed' : item.end.state === 'aborted' ? 'cancelled'
      : item.end.state === 'stopped' ? 'interrupted' : 'completed'
    tasks.set(id, { id, conversationId, title: activityTitle(calls), messages, calls, status, timestamp: previous?.timestamp ?? timestamp })
  }
  const result = [...tasks.values()]
  const last = result[result.length - 1]
  // Only the current unfinished message can inherit the live turn's activity.
  if (running && last && (last.id === activeSubmissionId || (activeSubmissionId === null && last.messages.some((message) => message.end.state === 'stopped')))) {
    result[result.length - 1] = { ...last, status: 'running' }
  }
  return result.map((task) => task.status === 'completed' && task.calls.some((call) => resultState(call) === 'failed')
    ? { ...task, title: `${task.title} (with errors)` } : task)
}
