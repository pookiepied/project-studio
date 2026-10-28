import { useEffect, useState } from 'react'
import { createConversationClient, type AgentTask } from '@/platform/harness'
import { applyChunks, emptyProjection, reseeded } from '@/features/chat/transcript/projection'
import { workspaceTasks } from './workspaceTasks'
import { WorkspaceTaskDetail } from './WorkspaceOverview'
import { useAgentTasks } from '@/features/jobs/useAgentTasks'
import { readableName } from '@/features/chat/transcript/live/toolResult'

/** A read-only subscriber. Closing inspection cancels the read, never the worker. */
export function AgentInspector({ task, conversationId }: { task: AgentTask; conversationId: string }) {
  const [projection, setProjection] = useState(emptyProjection)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const activity = useAgentTasks({ conversationId })
  const current = activity.tasks.find((item) => item.id === task.id) ?? task
  const running = ['running', 'queued', 'waiting_for_user'].includes(current.status)
  useEffect(() => {
    if (task.parentConversationId !== conversationId) return
    let disposed = false
    const client = createConversationClient({ conversationId: task.id, agentName: task.agentName, observationConversationId: conversationId })
    setProjection(emptyProjection())
    setError(null)
    const handle = client.attach({ onEvent: (event) => {
      if (disposed) return
      if (event.kind === 'snapshot') setProjection((value) => reseeded(value, event.snapshot))
      if (event.kind === 'chunks') setProjection((value) => applyChunks(value, event.chunks, event.replaying ? null : Date.now()))
    } })
    void handle.settled.then((result) => {
      if (disposed) return
      if (result.outcome === 'broken' || result.outcome === 'refused') setError('The execution transcript could not be read. Reconnect to try again.')
      if (result.outcome === 'absent') setError('No execution transcript is available for this agent.')
    })
    return () => { disposed = true; void handle.cancel() }
  }, [task.id, task.agentName, task.parentConversationId, conversationId, revision])
  const tasks = workspaceTasks(conversationId, projection.items, running)
  return <div className="flex flex-col gap-4">
    <div className="text-caption"><p>{readableName(task.agentName)}</p><p className="text-micro capitalize text-muted-foreground">{current.status.replaceAll('_', ' ')}</p>
      <p className="text-micro text-muted-foreground">Started {new Date(task.createdAt).toLocaleString()}</p>
      {current.settledAt !== null ? <p className="text-micro text-muted-foreground">Duration {Math.max(0, Math.round((current.settledAt - current.createdAt) / 1000))}s</p> : null}
      {running ? <button type="button" disabled={activity.isCancelling(task.id)} onClick={() => { void activity.cancel(task.id) }} className="mt-2 rounded-md bg-tint px-2 py-1 text-caption">{activity.isCancelling(task.id) ? 'Stop requested' : 'Stop agent'}</button> : null}
    </div>
    {error || activity.error ? <div role="status" className="text-caption text-muted-foreground">{error ?? activity.error}<button type="button" className="ml-2 underline" onClick={() => setRevision((value) => value + 1)}>Reconnect</button></div> : null}
    {tasks.map((item) => <WorkspaceTaskDetail key={item.id} task={item} worker />)}
    {tasks.length === 0 && !error ? <p className="text-caption text-muted-foreground">Waiting for recorded activity.</p> : null}
    {current.resultSummary ? <p className="whitespace-pre-wrap text-caption">{current.resultSummary}</p> : null}
  </div>
}
