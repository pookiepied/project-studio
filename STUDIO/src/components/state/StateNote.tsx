import type { ReactNode } from 'react'

/**
 * The sentence a surface shows when it is not showing content.
 *
 * ---- Why one component -----------------------------------------------------
 *
 * Every state that is not a list of records -- a read that failed, a harness
 * that is not running, an archive that is genuinely empty -- used to be typeset
 * by hand where it happened, and the hand-typed ones had already begun to
 * disagree: different paddings, different orders of sentence and remedy, one
 * pane putting the retry button above the explanation and another below it. A
 * state the app shows in ten places is part of the design system, and the
 * system is the component.
 *
 * The shape is deliberately the one `ProvidersPane` drew first, because it was
 * the right one: a title that names what could not happen in the surface's own
 * voice, the failure's verbatim words underneath it in the caption role -- the
 * wire's own sentence, never a paraphrase, because "what did the harness say"
 * is the first question anyone asks -- and the remedy, if there is one, below
 * both. Panes and columns can re-space it; nobody re-orders it.
 *
 * Empty is a different component on purpose. An empty state is an absence
 * naming itself ("Nothing archived."), not a quiet failure, and giving it the
 * failure's title-plus-detail shape would make a working system look broken.
 */
export function StateNote({
  title,
  detail,
  action,
  className,
}: {
  /** What happened, in the surface's voice: "Could not read providers." */
  title: string
  /** The cause, verbatim where one arrived from the wire. */
  detail?: string
  /** The remedy, if there is one -- usually a `Button`. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-start gap-3 py-4 ${className ?? ''}`}>
      <div>
        <p className="text-ui text-foreground">{title}</p>
        {detail ? <p className="mt-0.5 text-caption text-muted-foreground">{detail}</p> : null}
      </div>
      {action}
    </div>
  )
}
