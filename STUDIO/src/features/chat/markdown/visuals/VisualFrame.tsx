import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The ground a reply's visual sits on: a white sheet lifted off the page.
 *
 * Not the sunken ground of tables and code. A chart, a row of figures, a
 * timeline is the reply *showing* something rather than carrying an object
 * away, and it reads best the way a printed figure does -- white, quiet, one
 * soft edge, the editorial serif on its title, and colour spent only on the
 * data. In dark mode the raised surface is the same idea one step up from
 * the page.
 */
export function VisualFrame({
  title,
  subtitle,
  actions,
  footer,
  className,
  children,
}: {
  title?: string
  subtitle?: string
  /** Controls at the head's right -- the table toggle. */
  actions?: ReactNode
  /** A source line, under everything. */
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  const head = title !== undefined || subtitle !== undefined || actions !== undefined
  return (
    <figure className={cn('my-5 w-full min-w-0 rounded-2xl bg-surface-raised p-5 shadow-raised', className)}>
      {head ? (
        <figcaption className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title !== undefined ? <div className="studio-heading text-foreground">{title}</div> : null}
            {subtitle !== undefined ? <div className="mt-0.5 text-caption text-muted-foreground">{subtitle}</div> : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </figcaption>
      ) : null}
      {children}
      {footer !== undefined ? <div className="mt-3 text-caption text-muted-foreground">{footer}</div> : null}
    </figure>
  )
}

/** The colour of the series at an index; the order is fixed, never cycled. */
export function seriesColor(index: number): string {
  return `var(--series-${index + 1})`
}
