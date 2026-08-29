import { Icons } from '@/components/icons'
import { useRail, type RailEntry } from '@/stores/rail'
import { cn } from '@/lib/cn'

/**
 * What is open in the rail.
 *
 * A flat strip of tabs works until about six, and then stops: the labels shrink
 * past reading, the strip scrolls sideways, and finding the thing you opened
 * two minutes ago means dragging through it. Artifacts arrive in bursts — a
 * single coding turn can produce five — so six is a normal afternoon, not an
 * edge case.
 *
 * So entries are grouped by the conversation that produced them, and the group
 * heading only appears when there is more than one. With everything from one
 * conversation it reads as a plain list; the moment a second conversation
 * contributes, the list explains itself without having been rearranged.
 *
 * It is a vertical list rather than a horizontal strip for the same reason:
 * titles are sentences, and a sentence in a horizontal tab is three words and
 * an ellipsis.
 */
export function RailTabs() {
  const { entries, activeId, focus, close } = useRail()

  const groups = groupByConversation(entries)
  const grouped = groups.length > 1

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-2 pb-2">
      {groups.map((group) => (
        <div key={group.conversationId} className="flex flex-col">
          {grouped ? (
            <p className="truncate px-2 pb-1 text-micro text-muted-foreground/80 uppercase">
              {group.conversationTitle}
            </p>
          ) : null}

          {group.entries.map((entry) => {
            const active = entry.id === activeId
            return (
              <div
                key={entry.id}
                className={cn(
                  'group/tab flex h-8 items-center gap-2 rounded-lg pr-1 pl-2',
                  'transition-colors duration-fast',
                  active ? 'bg-selected' : 'hover:bg-tint',
                )}
              >
                <button
                  type="button"
                  onClick={() => focus(entry.id)}
                  aria-current={active ? 'true' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="shrink-0">
                    <Icons.artifact />
                  </span>
                  <span
                    className={cn(
                      'min-w-0 truncate text-caption',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {entry.artifact.title}
                  </span>
                </button>

                {/* Revealed on hover, but always occupying its space, so the
                    title does not reflow the instant the pointer arrives. */}
                <button
                  type="button"
                  onClick={() => close(entry.id)}
                  aria-label={`Close ${entry.artifact.title}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-fast group-hover/tab:opacity-100 hover:bg-tint hover:text-foreground focus-visible:opacity-100"
                >
                  <Icons.close />
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

interface Group {
  readonly conversationId: string
  readonly conversationTitle: string
  readonly entries: readonly RailEntry[]
}

/**
 * Group in first-seen order.
 *
 * Not sorted by title or by time. The rail is a record of what you opened, and
 * reordering it under someone mid-task moves the thing they were about to click.
 */
function groupByConversation(entries: readonly RailEntry[]): Group[] {
  const groups: Group[] = []

  for (const entry of entries) {
    const existing = groups.find((group) => group.conversationId === entry.conversationId)
    if (existing) {
      ;(existing.entries as RailEntry[]).push(entry)
      continue
    }
    groups.push({
      conversationId: entry.conversationId,
      conversationTitle: entry.conversationTitle,
      entries: [entry],
    })
  }

  return groups
}
