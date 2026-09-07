import { Tooltip } from '@/components/primitives'
import { cn } from '@/lib/cn'

/**
 * The context meter, and the strip's one moving part while a turn runs.
 *
 * ---- Present, but quiet ---------------------------------------------------
 *
 * It used to draw nothing below 60%, on the argument that a meter always on
 * screen is a number the user is invited to watch, and watching it is never
 * the work. The argument was right about the NUMBER and wrong about the ring:
 * a meter that is absent most of the time cannot be found when you go looking
 * for it, and this one was absent always - it was reading a `messages` array
 * that is empty for every live conversation, so it never once appeared.
 *
 * So the ring is always there on a conversation, the figure is on the tooltip
 * whenever you want it, and the percentage only prints itself beside the ring
 * at 60% - early enough to change what you do next, late enough to be news.
 *
 * ---- Why it also carries the run ------------------------------------------
 *
 * While a turn runs the ring turns with it, beside a title wearing the same
 * shimmer the transcript puts on a running tool row. It is not REPORTING the
 * run - the title is - it is moving in sympathy so the strip has one live
 * thing rather than two competing ones. That distinction matters for what
 * comes next: when compaction arrives, this ring becomes the loudest thing in
 * the window at the moment the context actually matters, and it will need its
 * meaning back undivided.
 */
export function ContextMeter({
  used,
  running,
  measured,
}: {
  readonly used: number
  /** A turn is in flight: the ring turns until it settles. */
  readonly running: boolean
  /** True when the figure came from reported usage rather than the estimate. */
  readonly measured: boolean
}) {
  const radius = 5
  const circumference = 2 * Math.PI * radius
  const percent = Math.round(used * 100)

  return (
    <Tooltip
      label={
        measured
          ? `${percent}% of the context window used`
          : `About ${percent}% of the context window used, estimated until a turn reports`
      }
      side="bottom"
    >
      <span className="flex h-6 shrink-0 items-center gap-1 px-1.5 text-caption text-muted-foreground">
        <svg
          viewBox="0 0 14 14"
          className={cn('size-3.5 -rotate-90', running && 'studio-spin')}
          aria-hidden
        >
          <circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="stroke-foreground/15" />
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-foreground/55"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - used)}
          />
        </svg>
        {percent >= 60 ? `${percent}%` : null}
      </span>
    </Tooltip>
  )
}
