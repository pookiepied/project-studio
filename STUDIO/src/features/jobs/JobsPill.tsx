import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'
import type { BackgroundJob } from '@/platform/harness'

/**
 * The background commands' disclosure control.
 *
 * It sits beside the plan pill and answers the one question a person has about
 * a process they did not start: is it still going. When exactly one thing is
 * running it names it, because at that point the count is less informative
 * than the command line; past one, the count is the only thing that fits.
 *
 * It renders only while the conversation has commands at all - a pill that
 * says "none" is a permanent piece of furniture reporting the absence of
 * something nobody asked about.
 */
export function JobsPill({
  jobs,
  open,
  onToggle,
}: {
  readonly jobs: readonly BackgroundJob[]
  /** Whether the rail is showing this conversation's commands right now. */
  readonly open: boolean
  readonly onToggle: () => void
}) {
  const running = jobs.filter((job) => job.state === 'running')
  const failed = jobs.filter(
    (job) => job.state === 'failed' || (job.state === 'exited' && job.exitCode !== 0),
  )

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1',
        'text-caption transition-colors duration-fast',
        'border-hairline bg-surface text-muted-foreground shadow-chip',
        'hover:text-foreground',
      )}
    >
      <span className="shrink-0">
        <Icons.backgroundJobs size="sm" />
      </span>
      <span className="min-w-0 truncate">
        {running.length === 1 && running[0] !== undefined ? (
          <>
            <span className="tabular-nums">1 running</span>
            <span aria-hidden className="px-1.5 text-muted-foreground/60">
              ·
            </span>
            <span className="text-muted-foreground">{running[0].command}</span>
          </>
        ) : running.length > 0 ? (
          <span className="tabular-nums">{running.length} running</span>
        ) : failed.length > 0 ? (
          // An ended run is not news for long, but a failed one is the reason
          // somebody opens this panel at all.
          <span className="tabular-nums">
            {failed.length === 1 ? '1 command failed' : `${failed.length} commands failed`}
          </span>
        ) : (
          <span className="tabular-nums">
            {jobs.length === 1 ? '1 command finished' : `${jobs.length} commands finished`}
          </span>
        )}
      </span>
    </button>
  )
}
