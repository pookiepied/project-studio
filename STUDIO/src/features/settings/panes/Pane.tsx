import type { ReactNode } from 'react'

/**
 * The shape every settings pane takes.
 *
 * One layout, used by all of them, so a section added later cannot invent its
 * own spacing. The pane's available width decides whether labels and controls
 * sit together or stack, including when this pane lives inside another surface.
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
    <div className="studio-settings-pane">
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
    <div className="studio-settings-row">
      <div className="studio-settings-label">
        <p className="text-ui text-foreground">{label}</p>
        {hint ? <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {children ? <div className="studio-settings-control">{children}</div> : null}
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

