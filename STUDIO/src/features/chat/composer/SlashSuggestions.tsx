import { useEffect, useRef } from 'react'
import { Icons } from '@/components/icons'
import type { CommandRecord } from '@/platform/harness'
import { cn } from '@/lib/cn'

/**
 * The commands a slash offers, above the field.
 *
 * A list, not a menu: it appears because of what was typed and follows the
 * typing, and the keyboard that is already in the field drives it - up and
 * down to move, Enter or Tab to take, Escape to dismiss - so the hands never
 * leave the words. Each row is the name in the field's own type, the hint
 * for what follows it, and the one line that says what it does. The picked
 * row is marked the way a menu marks its selection; nothing else is drawn,
 * because the list sits over the transcript and should weigh nothing.
 */
export function SlashSuggestions({
  commands,
  selected,
  onPick,
  onHover,
}: {
  commands: readonly CommandRecord[]
  selected: number
  onPick: (command: CommandRecord) => void
  onHover: (index: number) => void
}) {
  const list = useRef<HTMLUListElement>(null)

  // The picked row stays in view as the arrows move it past the edge.
  useEffect(() => {
    const element = list.current?.children[selected]
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (commands.length === 0) {
    return (
      <div className="mb-2 rounded-md bg-surface-raised px-2.5 py-2 text-caption text-muted-foreground shadow-raised">
        No command by that name. Sent as written.
      </div>
    )
  }

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Commands"
      className="studio-scroll-bounded mb-2 max-h-56 overflow-y-auto rounded-md bg-surface-raised py-1 shadow-raised"
    >
      {commands.map((command, index) => (
        <li
          key={command.id}
          role="option"
          aria-selected={index === selected}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            // Before the field loses focus to the click, so the words land
            // in a field that still has the caret.
            event.preventDefault()
            onPick(command)
          }}
          className={cn(
            'flex cursor-default items-baseline gap-2 px-2.5 py-1.5',
            index === selected ? 'bg-selected' : '',
          )}
        >
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-ui text-foreground">
            {command.kind === 'action' ? <Icons.compaction size="sm" /> : <Icons.command size="sm" />}/
            {command.id}
          </span>
          {command.argumentHint !== '' ? (
            <span className="shrink-0 font-mono text-caption text-muted-foreground">
              {command.argumentHint}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {command.description}
          </span>
        </li>
      ))}
    </ul>
  )
}
