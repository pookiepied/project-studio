import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'
import type { PlanSnapshot } from '@/platform/harness'

/**
 * The plan's disclosure control.
 *
 * It says the two numbers a person actually wants - how many are done, how
 * many there are - and, when something is running, that item's text, because
 * mid-run that is the useful thing on screen. Everything else lives in the
 * panel behind the click: this is a disclosure control and nothing else, with
 * no menu, no hover card, and no ring that animates on every poll.
 */
export function PlanPill({
  snapshot,
  items,
  open,
  onToggle,
}: {
  /** The plan as last read; non-null whenever the pill renders. */
  readonly snapshot: PlanSnapshot
  readonly items: PlanSnapshot['items']
  /** Whether the rail is showing this conversation's plan right now. */
  readonly open: boolean
  readonly onToggle: () => void
}) {
  // Damaged is said plainly: the panel behind the click carries the remedy,
  // and a count over rows nobody can read would be an invention.
  if (snapshot.damaged) {
    return (
      <PillButton open={open} onToggle={onToggle} tone="damaged">
        Plan could not be read
      </PillButton>
    )
  }

  const done = items.filter((item) => item.status === 'done').length
  const running = items.find((item) => item.status === 'running')
  const allDone = items.length > 0 && done === items.length

  return (
    <PillButton open={open} onToggle={onToggle}>
      <span className="tabular-nums">{allDone ? 'All done' : `${done} of ${items.length}`}</span>
      {running !== undefined ? (
        <>
          {/* The running item's text is the moment's fact; one line, cut
              before it can crowd the count it sits beside. */}
          <span aria-hidden className="text-muted-foreground/60">
            ·
          </span>
          <span className="max-w-44 truncate text-muted-foreground">{running.text}</span>
        </>
      ) : null}
    </PillButton>
  )
}

function PillButton({
  open,
  onToggle,
  tone,
  children,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly tone?: 'damaged'
  readonly children: React.ReactNode
}) {
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
        tone === 'damaged' && 'text-foreground',
      )}
    >
      <span className="shrink-0">
        <Icons.plan size="sm" />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}
