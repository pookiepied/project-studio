import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { createConversationClient, type AgentTask } from '@/platform/harness'
import { applyChunks, emptyProjection, reseeded, type ToolCallView } from '@/features/chat/transcript/projection'
import { callsIn } from '@/features/chat/transcript/live/taskEvidence'
import { familyOf } from '@/features/chat/transcript/live/reportFamily'
import { readableName } from '@/features/chat/transcript/live/toolResult'
import { useAgentTasks } from '@/features/jobs/useAgentTasks'
import { agentStatus } from './Activity'
import { cn } from '@/lib/cn'

/** How many of the agent's latest steps are named. Older ones are a count. */
const RECENT_STEPS = 6

/** A step in the person's words: what kind of work, never its arguments. */
export function stepLabel(call: ToolCallView): string {
  const family = familyOf(call.toolName)
  if (family) return family.id === 'computer' ? 'Working with your computer' : 'Using the browser'
  if (call.toolName === 'task') return 'Delegating work'
  if (['read', 'glob', 'grep'].includes(call.toolName)) return 'Reading project files'
  if (['edit', 'write', 'move', 'delete'].includes(call.toolName)) return 'Changing project files'
  if (['shell', 'jobs'].includes(call.toolName)) return 'Running a command'
  if (call.toolName === 'plan') return 'Planning'
  if (['web_search', 'fetch'].includes(call.toolName)) return 'Researching the web'
  if (call.toolName.startsWith('studio_')) return 'Creating media'
  return readableName(call.toolName)
}

/**
 * One agent, as activity: what it is, how it is going, what it is doing now,
 * the last few things it did, and how it ended.
 *
 * Its transcript is read only to name its steps. The words it wrote, its
 * reasoning and its tools' results are its own conversation's business, and
 * the answer comes back to the parent conversation as the reply's - drawing
 * them here was the history this workspace no longer keeps. Closing this view
 * cancels the read, never the agent.
 */
export function AgentActivity({ task, conversationId }: { task: AgentTask; conversationId: string }) {
  const [calls, setCalls] = useState<readonly ToolCallView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const agents = useAgentTasks({ conversationId })
  const current = agents.tasks.find((item) => item.id === task.id) ?? task
  const running = ['running', 'queued', 'waiting_for_user'].includes(current.status)

  useEffect(() => {
    if (task.parentConversationId !== conversationId) return
    let disposed = false
    let projection = emptyProjection()
    const client = createConversationClient({ conversationId: task.id, agentName: task.agentName, observationConversationId: conversationId })
    setCalls([])
    setError(null)
    const publish = () => setCalls(projection.items.flatMap((item) => item.kind === 'assistant' ? callsIn(item.segments) : []))
    const handle = client.attach({ onEvent: (event) => {
      if (disposed) return
      if (event.kind === 'snapshot') projection = reseeded(projection, event.snapshot)
      if (event.kind === 'chunks') projection = applyChunks(projection, event.chunks, event.replaying ? null : Date.now())
      publish()
    } })
    void handle.settled.then((result) => {
      if (disposed) return
      if (result.outcome === 'broken' || result.outcome === 'refused') setError('Its steps could not be read. Reconnect to try again.')
    })
    return () => { disposed = true; void handle.cancel() }
  }, [task.id, task.agentName, task.parentConversationId, conversationId, revision])

  const recent = calls.slice(-RECENT_STEPS)
  const earlier = calls.length - recent.length
  const started = new Date(current.createdAt)
  const seconds = current.settledAt === null ? null : Math.max(0, Math.round((current.settledAt - current.createdAt) / 1000))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-foreground">{readableName(task.agentName)}</p>
          <p className={cn('text-micro', current.status === 'failed' ? 'text-danger' : 'text-muted-foreground')}>
            {agentStatus(current)} · started {started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            {seconds === null ? '' : ` · took ${String(seconds)}s`}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            disabled={agents.isCancelling(task.id)}
            onClick={() => { void agents.cancel(task.id) }}
            className="shrink-0 rounded-full bg-muted px-3 py-1 text-caption hover:bg-soft disabled:opacity-50"
          >
            {agents.isCancelling(task.id) ? 'Stop requested' : 'Stop agent'}
          </button>
        ) : null}
      </div>

      {error ?? agents.error ? (
        <p role="status" className="text-caption text-muted-foreground">
          {error ?? agents.error}
          <button type="button" className="ml-2 underline" onClick={() => setRevision((value) => value + 1)}>Reconnect</button>
        </p>
      ) : null}

      {calls.length === 0 ? (
        <p className="text-caption text-muted-foreground">{running ? 'Starting.' : 'No steps were recorded.'}</p>
      ) : (
        <ol aria-label="Steps" className="flex flex-col gap-1.5 text-ui">
          {earlier > 0 ? <li className="text-micro text-muted-foreground">{String(earlier)} earlier {earlier === 1 ? 'step' : 'steps'}</li> : null}
          {recent.map((call, index) => {
            const now = running && index === recent.length - 1 && call.output === null && call.errorText === null
            return (
              <li key={call.toolCallId} className={cn('flex items-center gap-2', now ? 'studio-shimmer text-foreground' : 'text-muted-foreground')}>
                <span className="shrink-0">{now ? <Icons.generate size="sm" /> : call.errorText !== null ? <Icons.failed size="sm" /> : <Icons.check size="sm" />}</span>
                <span className="min-w-0 truncate">{stepLabel(call)}</span>
              </li>
            )
          })}
        </ol>
      )}

      {current.resultSummary ? (
        <div className="flex flex-col gap-1">
          <span className="text-micro text-muted-foreground">Result</span>
          <p className="whitespace-pre-wrap text-caption">{current.resultSummary}</p>
        </div>
      ) : null}
    </div>
  )
}
