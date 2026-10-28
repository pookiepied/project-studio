import { useAgentTasks } from '@/features/jobs/useAgentTasks'
import { cn } from '@/lib/cn'
import type { AgentTask } from '@/platform/harness'
import { useState } from 'react'
import { Icons } from '@/components/icons'

/**
 * The background agent tasks, as a person sees them.
 *
 * A task is work the harness dispatched on its own behalf - the titling pass
 * was the first, and everything the harness dispatches the way it dispatches
 * the titler joins the same index. The rows answer three questions and no
 * more, the same discipline the commands' rows keep: what was dispatched,
 * how it went, and - while it is still going - the way to stop it. There is
 * full output in the compact row: selecting it opens its recorded transcript.
 */
export function TasksSection({ conversationId, onInspect }: { conversationId: string; onInspect?: (task: AgentTask) => void }) {
  const { tasks, isCancelling, cancel, error } = useAgentTasks({ conversationId })
  const [limit, setLimit] = useState(20)
  const live = (task: AgentTask) => ['running', 'queued', 'waiting_for_user'].includes(task.status)
  const ordered = [...tasks.filter(live), ...tasks.filter((task) => !live(task))]

  if (tasks.length === 0) return error ? <p role="status" className="text-caption text-danger">{error}</p> : null

  return (
    <section className="flex flex-col gap-2">
      {error ? <p role="status" className="text-caption text-danger">{error}</p> : null}
      <h3 className="px-2 text-micro font-medium text-muted-foreground">Agents</h3>
      <ul className="flex flex-col gap-2">
        {ordered.slice(0, limit).map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            busy={isCancelling(task.id)}
            onCancel={() => void cancel(task.id)}
            onInspect={onInspect ? () => onInspect(task) : undefined}
          />
        ))}
      </ul>
      {tasks.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 20)} className="text-left text-caption text-muted-foreground">Show more agents</button> : null}
    </section>
  )
}

/** How a task settled, or that it has not. One phrase, in the person's words. */
function statusLabel(task: AgentTask): string {
  if (task.status === 'running') return 'Running'
  if (task.status === 'queued') return 'Queued'
  if (task.status === 'waiting_for_user') return 'Waiting for you'
  if (task.status === 'cancelled') return 'Stopped'
  if (task.status === 'failed') return 'Failed'
  if (task.status === 'unknown') return 'Unknown'
  return 'Finished'
}

function TaskRow({
  task,
  busy,
  onCancel,
  onInspect,
}: {
  task: AgentTask
  busy: boolean
  onCancel: () => void
  onInspect?: () => void
}) {
  const running = task.status === 'running' || task.status === 'queued' || task.status === 'waiting_for_user'
  const failed = task.status === 'failed'

  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-tint">
      <span aria-hidden className="flex size-[var(--control-md)] shrink-0 items-center justify-center rounded-lg bg-surface text-ui text-muted-foreground"><Icons.agents /></span>
      {onInspect ? <button type="button" onClick={onInspect} className="min-w-0 flex-1 truncate text-left text-ui text-foreground hover:underline">{task.title}</button>
        : <span className="min-w-0 flex-1 truncate text-ui text-foreground">{task.title}</span>}
      <span
        className={cn(
          'shrink-0 text-micro',
          failed ? 'text-danger' : 'text-muted-foreground',
        )}
        title={task.resultSummary ?? undefined}
      >
        {statusLabel(task)}
      </span>
      {running ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 text-micro',
            'text-muted-foreground transition-colors duration-fast',
            'hover:bg-tint hover:text-foreground disabled:opacity-50',
          )}
        >
          {busy ? 'Stop requested' : 'Stop'}
        </button>
      ) : null}
    </li>
  )
}
