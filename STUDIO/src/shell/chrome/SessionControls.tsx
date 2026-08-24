import { Tooltip } from '@/components/primitives'

/**
 * The context meter.
 *
 * A ring, and not drawn at all below the threshold. A meter that is always
 * present is a number the user is invited to watch, and watching it is never
 * the work — for most of a conversation the honest reading is "this is not
 * something you need to think about", and the honest way to render that is
 * nothing. It appears at 60%: early enough to change what you do next, late
 * enough to be news.
 */
export function ContextMeter({ used }: { used: number }) {
  if (used < 0.6) return null

  const radius = 5
  const circumference = 2 * Math.PI * radius
  const percent = Math.round(used * 100)

  return (
    <Tooltip label={`${percent}% of the context window used`} side="bottom">
      <span className="flex h-6 shrink-0 items-center gap-1 px-1.5 text-caption text-muted-foreground">
        <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90" aria-hidden>
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
        {percent}%
      </span>
    </Tooltip>
  )
}
