import { useAgentTasks } from '@/features/jobs/useAgentTasks'
import { cn } from '@/lib/cn'
import type { AgentTask } from '@/platform/harness'

/**
 * The background agent tasks, as a person sees them.
 *
 * A task is work the harness dispatched on its own behalf - the titling pass
 * was the first, and everything the harness dispatches the way it dispatches
 * the titler joins the same index. The rows answer three questions and no
 * more, the same discipline the commands' rows keep: what was dispatched,
 * how it went, and - while it is still going - the way to stop it. There is
 * no output to read here by design: a task's answer is its own transcript in
 * the harness, and a row that promised the answer would be promising a
 * second copy of it.
 */
export function TasksSection() {
  const { tasks, cancellingId, cancel } = useAgentTasks()

  if (tasks.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-micro font-medium text-muted-foreground uppercase">Agent tasks</h3>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            busy={cancellingId === task.id}
            onCancel={() => void cancel(task.id)}
          />
        ))}
      </ul>
    </section>
  )
}

/** How a task settled, or that it has not. One phrase, in the person's words. */
function statusLabel(task: AgentTask): string {
  if (task.status === 'running' || task.status === 'queued') return 'Running'
  if (task.status === 'waiting_for_user') return 'Waiting for you'
  if (task.status === 'cancelled') return 'Stopped'
  if (task.status === 'failed') return task.resultSummary ?? 'Failed'
  if (task.status === 'unknown') return 'Unknown'
  return 'Finished'
}

function TaskRow({
  task,
  busy,
  onCancel,
}: {
  task: AgentTask
  busy: boolean
  onCancel: () => void
}) {
  const running = task.status === 'running' || task.status === 'queued' || task.status === 'waiting_for_user'
  const failed = task.status === 'failed'

  return (
    <li className="flex items-baseline gap-2">
      {/* A filled dot for a live task, a hollow one for an ended one - the
          same glance the commands' rows teach. */}
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          running ? 'bg-foreground' : failed ? 'bg-danger' : 'bg-muted-foreground/40',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-caption text-foreground">{task.title}</span>
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
          Stop
        </button>
      ) : null}
    </li>
  )
}
