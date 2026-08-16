import { cn } from '@/lib/utils'

/**
 * A label that is always as wide as the widest thing it could say.
 *
 * Every candidate is rendered into the same grid cell — `grid-area: 1/1` for
 * all of them — so the cell sizes to the widest and the rest stack invisibly
 * underneath. The pill therefore never changes width when the value changes,
 * and the row of controls beside it never shifts under the pointer.
 *
 * The alternative — measuring text and setting a pixel width — is wrong in the
 * ways that only show up later: it is stale until the font loads, it ignores
 * user zoom, and it silently truncates the first label longer than whatever
 * number was hardcoded. The previous composer used a hardcoded 104px and had
 * all three problems.
 *
 * The wrapper must be `grid` and nothing else. An earlier version composed
 * this with the shared `pillLabel` class, which carries `inline-flex`: the two
 * display declarations fought, flex won, and the four candidates laid out side
 * by side — a 455px pill. Layout classes do not compose; that is why this
 * component owns its own and takes no class overrides for them.
 */
export function StableLabel({
  value,
  candidates,
  className,
}: {
  /** What to actually show. */
  value: string
  /** Everything this control could show, including `value`. */
  candidates: readonly string[]
  className?: string
}) {
  return (
    <span className={cn('grid min-w-0 items-center text-left', className)}>
      {candidates.map((candidate) => (
        <span
          key={candidate}
          aria-hidden
          className="invisible truncate [grid-area:1/1]"
        >
          {candidate}
        </span>
      ))}
      <span className="truncate [grid-area:1/1]">{value}</span>
    </span>
  )
}
