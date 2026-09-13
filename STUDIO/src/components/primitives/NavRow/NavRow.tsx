import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The quiet row: a mark, a label, and nothing until the pointer arrives.
 *
 * The sidebar's standing actions, the account row, the project and branch
 * chips in the identity line, the way back out of a model's detail -- every
 * one of them is a button that reads as text until hovered, when the tint
 * chip appears behind it (RULES §1: one channel per state, the glyph never
 * darkens or moves). They had each retyped the same nine utilities, and the
 * retyping had begun to drift a radius and a padding at a time.
 *
 * Not `Button`: that is a pill of fixed height for a verb that stands on its
 * own. This is a row in a list, as tall as its text, squared off to sit in
 * a column. Extra attributes pass through, which is how a row that opens a
 * menu carries its `aria-haspopup` and `aria-expanded`.
 */
export function NavRow({
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Leading mark. Sized by the icon system, never by this component. */
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
