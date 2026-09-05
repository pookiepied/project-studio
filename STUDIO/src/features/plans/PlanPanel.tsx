import { Icons } from '@/components/icons'
import { usePlan } from '@/features/plans/usePlan'
import { cn } from '@/lib/cn'
import type { ArtifactStatus } from '@/domain/artifacts/types'
import type { PlanItemRecord, PlanSnapshot } from '@/platform/harness'

/**
 * The plan panel: the conversation's items in position order, each with its
 * status, its text, and its tick.
 *
 * That is the whole panel, on purpose. It is not a dashboard - no timings, no
 * percentages, no filters, no sort control - because a person mid-conversation
 * reads a plan; they do not operate one. The one control besides the tick is
 * the clear, and it exists only where it is owed: on a damaged read, where the
 * rows cannot be trusted and the alternative to clearing is a plan nobody can
 * act on.
 */
export function PlanPanel({ conversationId }: { conversationId: string }) {
  const { snapshot, items, tickingId, tick, clear } = usePlan(conversationId)

  // Before the first read lands there is nothing honest to show; the poll
  // returns within a beat and the panel arrives with it.
  if (snapshot === null) return null

  if (snapshot.damaged) {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-caption text-muted-foreground">
          The plan could not be read from the store, so it cannot be shown or ticked. Clearing
          it removes whatever rows are there.
        </p>
        <button
          type="button"
          onClick={() => void clear()}
          className={cn(
            'self-start rounded-lg px-2.5 py-1.5 text-caption',
            'text-muted-foreground transition-colors duration-fast',
            'hover:bg-tint hover:text-foreground',
          )}
        >
          Clear the plan
        </button>
      </div>
    )
  }

  const done = items.filter((item) => item.status === 'done').length

  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className="text-caption tabular-nums text-muted-foreground">
        {items.length > 0 && done === items.length ? 'All done' : `${done} of ${items.length} done`}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <PlanRow
            key={item.id}
            item={item}
            busy={tickingId === item.id}
            onTick={() => void tick(item.id, item.status === 'done' ? 'pending' : 'done')}
          />
        ))}
      </ul>
    </div>
  )
}

function PlanRow({
  item,
  busy,
  onTick,
}: {
  readonly item: PlanItemRecord
  readonly busy: boolean
  readonly onTick: () => void
}) {
  const ticked = item.status === 'done'
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={ticked}
        disabled={busy}
        onClick={onTick}
        className={cn(
          'group/row flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left',
          'transition-colors duration-fast hover:bg-tint',
          busy && 'cursor-default',
        )}
      >
        <StatusMark status={item.status} />
        {/* The model's text is its own; the tick is the person's answer to it,
            so the row never restyles the words to imply a verdict of its own. */}
        <span
          className={cn(
            'min-w-0 flex-1 text-caption leading-relaxed',
            ticked ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {item.text}
        </span>
      </button>
    </li>
  )
}

/**
 * The status, drawn once and still.
 *
 * Nothing here animates on the poll - a mark that pulses every read is a
 * progress ring by another name, and the panel is not a dashboard.
 */
function StatusMark({ status }: { readonly status: ArtifactStatus }) {
  switch (status) {
    case 'done':
      return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-selected text-foreground">
          <Icons.check size="sm" />
        </span>
      )
    case 'failed':
      return (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <Icons.failed size="sm" />
        </span>
      )
    case 'running':
      return (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span className="size-2.5 rounded-full border border-foreground/50" />
        </span>
      )
    case 'cancelled':
      return (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span className="h-px w-2.5 bg-muted-foreground/60" />
        </span>
      )
    default:
      return (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span className="size-2.5 rounded-full border border-hairline" />
        </span>
      )
  }
}
