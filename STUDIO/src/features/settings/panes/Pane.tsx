import type { ReactNode } from 'react'
import { Placeholder, PlaceholderText } from '@/components/placeholder/Placeholder'

/**
 * The shape every settings pane takes.
 *
 * One layout, used by all of them, so a section added later cannot invent its
 * own spacing. The label column is fixed and the control column is fluid, which
 * is what keeps every control in the app aligned on the same x however long its
 * label runs.
 */
export function Pane({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[36rem]">
      <header className="mb-5">
        {/* The editorial serif, because this is a page title and that is the
            serif's one job (ADR 0043). It was set in `text-title` — Inter,
            semibold — which made Settings the only page in the app whose
            heading answered to a different voice than the home greeting and the
            dialog headers. One page disagreeing is what reads as the app using
            several fonts at random rather than two with a rule. */}
        <h1 className="studio-heading text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-ui text-muted-foreground">{description}</p> : null}
      </header>
      <div className="flex flex-col divide-y">{children}</div>
    </div>
  )
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-ui text-foreground">{label}</p>
        {hint ? <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  )
}

/**
 * A pane that has no controls yet.
 *
 * It says what will live here rather than showing an empty frame, because a
 * blank pane is indistinguishable from one that failed to load. Every section
 * in the tree resolves to something, which is what makes the tree honest.
 */
export function PlaceholderPane({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: readonly string[]
}) {
  return (
    <Pane title={title} description={description}>
      <div className="py-4">
        <p className="mb-2 text-caption text-muted-foreground">This section will hold:</p>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-ui text-muted-foreground">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-caption text-muted-foreground/80">
          Waiting on the harness. The layout is settled; the values are not wired.
        </p>
      </div>
    </Pane>
  )
}

/**
 * A pane that is on its way: the frame with bones where the title, the
 * description and the first rows will be.
 *
 * Composed from `Pane` and `Row`'s own spacing, so the skeleton has exactly
 * the geometry of the pane it becomes and the handover is a change of fill.
 * The widths vary on purpose; a column of equal bars reads as a pattern.
 * `Pane`'s header is a real `h1`, so the bone stands in for the text inside
 * the same elements rather than beside them.
 */
export function PaneSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[36rem]" aria-hidden>
      <header className="mb-5">
        <p className="studio-heading">
          <PlaceholderText width="34%" />
        </p>
        <p className="mt-1 text-ui">
          <PlaceholderText width="62%" />
        </p>
      </header>
      <div className="flex flex-col divide-y">
        {(['46%', '38%', '52%'] as const).map((width, index) => (
          <div key={index} className="flex items-start justify-between gap-6 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-ui">
                <PlaceholderText width={width} />
              </p>
              <p className="mt-0.5 text-caption">
                <PlaceholderText width="70%" />
              </p>
            </div>
            <Placeholder className="h-7 w-24 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
