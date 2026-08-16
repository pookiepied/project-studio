import type { ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/** A section caption inside a menu. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-1.5 pb-1 text-micro text-muted-foreground">{children}</p>
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />
}

export function MenuItem({
  onSelect,
  selected = false,
  icon,
  hint,
  note,
  destructive = false,
  children,
}: {
  onSelect: () => void
  /** Draws a check in a reserved column, so rows stay aligned whether set or not. */
  selected?: boolean
  icon?: ReactNode
  /** Trailing secondary text: a shortcut, a value, a count. */
  hint?: string
  /** A second line under the label, saying what the option is for. */
  note?: string
  destructive?: boolean
  children: ReactNode
}) {
  const showCheckColumn = selected !== undefined && icon === undefined

  return (
    <button
      type="button"
      role={showCheckColumn ? 'menuitemradio' : 'menuitem'}
      aria-checked={showCheckColumn ? selected : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-ui',
        'transition-colors duration-100',
        selected ? 'text-foreground' : 'text-muted-foreground',
        'hover:bg-tint hover:text-foreground',
        // Delete and its kin say so with the mark, since the label alone reads
        // like every other row until you have finished reading it. This is the
        // one place a glyph carries meaning by colour, so it opts out of the
        // muted default rather than the rule being softened for everyone.
        destructive && '[&_.studio-icon]:text-red-500/80 hover:[&_.studio-icon]:text-red-500',
      )}
    >
      {icon ? (
        <span className="mt-px flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      ) : (
        // Reserved rather than conditional: a check that appears and pushes the
        // label sideways makes the whole menu twitch as the selection moves.
        <span className="mt-px flex size-3.5 shrink-0 items-center justify-center">
          {selected ? <Icons.check /> : null}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{children}</span>
        {note ? (
          <span className="mt-0.5 block text-micro leading-tight text-muted-foreground">{note}</span>
        ) : null}
      </span>

      {hint ? <span className="mt-px shrink-0 text-micro text-muted-foreground">{hint}</span> : null}
    </button>
  )
}
