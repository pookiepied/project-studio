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
        'transition-colors duration-fast',
        selected ? 'text-foreground' : 'text-muted-foreground',
        'hover:bg-tint hover:text-foreground',
        // Delete and its kin say so with the mark, since the label alone reads
        // like every other row until you have finished reading it. This is the
        // one place a glyph carries meaning by colour, so it opts out of the
        // muted default rather than the rule being softened for everyone.
        destructive && '[&_.studio-icon]:text-danger/80 hover:[&_.studio-icon]:text-danger',
      )}
    >
      {/* The icon column is exactly one line tall, and the mark is centred in
          it. That is what makes the glyph sit on the row's first line whether
          or not a note follows it — `items-start` keeps the column at the top,
          and `1lh` gives it the height of the line it is aligning to.

          It used to be `size-3.5` nudged down by `mt-px`. A 14px box on a
          18.6px line is 2.3px short of centred, and the `mt-px` was the half of
          that someone measured by eye — against a label that was then
          `leading-tight`. The moment the label took its role's real leading the
          nudge was compensating for a line box that no longer existed, and the
          icon sat 1.26px above the text's cap height in every menu in the app,
          including the right-click one. A hand-tuned margin cannot survive a
          change to the thing it was tuned against; a derived height can.

          Reserved rather than conditional: a check that appears and pushes the
          label sideways makes the whole menu twitch as the selection moves. */}
      <span className="flex h-[1lh] w-[1.1em] shrink-0 items-center justify-center">
        {icon ?? (selected ? <Icons.check /> : null)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {note ? (
          <span className="mt-0.5 block text-micro text-muted-foreground">{note}</span>
        ) : null}
      </span>

      {/* Same trick, and the wrapper is load-bearing: `1lh` resolves against
          the element's *own* line-height, so putting it on the `text-micro`
          span would measure the hint's 14.5px line rather than the label's
          18.6px one. The outer box inherits the row's `text-ui`; the micro
          styling goes inside it. */}
      {hint ? (
        <span className="flex h-[1lh] shrink-0 items-center">
          <span className="text-micro text-muted-foreground">{hint}</span>
        </span>
      ) : null}
    </button>
  )
}
