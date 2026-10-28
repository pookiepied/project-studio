import { useBackgroundJobs } from '@/features/jobs/useBackgroundJobs'
import { cn } from '@/lib/cn'
import type { BackgroundJob } from '@/platform/harness'

/**
 * The background commands panel: what this conversation left running, what it
 * printed, and the way to end it.
 *
 * Three things per row and no more. It is not a process manager - no CPU, no
 * memory, no uptime graph - because the questions a person actually has here
 * are "is it up", "what did it say", and "make it stop". Anything else is a
 * number they would have to interpret about a process they did not start.
 *
 * The output is shown inline rather than behind a disclosure. A job's output
 * is the reason the job is in the list at all: the port it bound, or the stack
 * trace it died on. Putting that behind a click makes the common case two
 * actions and the rare case one.
 */
export function JobsPanel({ conversationId }: { conversationId: string }) {
  const { jobs, stoppingId, stop, error } = useBackgroundJobs(conversationId)

  if (jobs.length === 0) {
    return (
      <p className="pt-1 text-caption text-muted-foreground">
        {error ?? 'Nothing is running in the background for this conversation.'}
      </p>
    )
  }

  const running = jobs.filter((job) => job.state === 'running').length

  return (
    <div className="flex flex-col gap-3 pt-1">
      {error ? <p role="status" className="text-caption text-danger">{error}</p> : null}
      <p className="text-caption tabular-nums text-muted-foreground">
        {running === 0
          ? `${jobs.length} finished`
          : `${running} running of ${jobs.length}`}
      </p>
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            busy={stoppingId === job.id}
            onStop={() => void stop(job.id)}
          />
        ))}
      </ul>
    </div>
  )
}

/** How a job ended, or that it has not. One phrase, in the person's words. */
function stateLabel(job: BackgroundJob): string {
  if (job.state === 'running') return 'Running'
  if (job.state === 'stopping') return 'Stopping'
  if (job.state === 'stopped') return 'Stopped'
  if (job.state === 'failed') return job.error ?? 'Never started'
  return job.exitCode === 0 ? 'Finished' : `Exited ${job.exitCode ?? '?'}`
}

function JobRow({
  job,
  busy,
  onStop,
}: {
  job: BackgroundJob
  busy: boolean
  onStop: () => void
}) {
  const running = job.state === 'running'
  // A non-zero exit is the one state worth colouring. Running and finished are
  // both ordinary; a command that failed is the row a person is looking for.
  const failed = job.state === 'failed' || (job.state === 'exited' && job.exitCode !== 0)

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        {/* A filled dot for a live process, a hollow one for an ended one. The
            state is also written out beside it - the dot is a glance, not the
            only way to read the row. */}
        <span
          aria-hidden
          className={cn(
            'mt-0.5 size-1.5 shrink-0 rounded-full',
            running ? 'bg-foreground' : failed ? 'bg-danger' : 'bg-muted-foreground/40',
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-caption text-foreground">
          Background command
        </span>
        <span
          className={cn(
            'shrink-0 text-micro',
            failed ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {stateLabel(job)}
        </span>
        {running ? (
          <button
            type="button"
            onClick={onStop}
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
      </div>

      <details><summary className="ml-3.5 cursor-pointer text-micro text-muted-foreground">Inspect command and output</summary>
      <code className="block break-all text-micro">{job.command}</code>
      {job.dropped > 0 ? (
        // Said rather than implied. A tail that quietly begins mid-stream reads
        // as the whole of the output.
        <p className="pl-3.5 text-micro text-muted-foreground">
          {job.dropped} earlier lines dropped
        </p>
      ) : null}

      {job.output === '' ? null : (
        <pre className="studio-scroll-inset ml-3.5 max-h-48 overflow-auto rounded-lg bg-tint px-2.5 py-2 font-mono text-micro whitespace-pre text-muted-foreground">
          {job.output}
        </pre>
      )}
      </details>
    </li>
  )
}
