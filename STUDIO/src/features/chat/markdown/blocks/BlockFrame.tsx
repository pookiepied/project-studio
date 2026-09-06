import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The block frame: code, or writing-as-an-object, set inside a reply.
 *
 * ---- What replaced what, and why -----------------------------------------
 *
 * The previous frame was a preview: content past a cap was held behind a
 * gradient fade and the full text was "one copy away". In a real coding
 * session that is backwards -- the code is not a thing to recognise, it is
 * the thing being worked on, and a reader who cannot see line forty does not
 * feel served by a clipboard. So the cap and the fade are gone and the body
 * scrolls inside itself instead: everything is on the page, reachable, and
 * the transcript still does not hand a two-thousand-line dump the run of the
 * column.
 *
 * ---- The container is the artifact container ------------------------------
 *
 * The frame is the artifact shell's box, verbatim in kind: sunken ground, one
 * radius, no border, no shadow. Code, a draft, a search result -- all objects
 * the reply is carrying rather than prose it is saying -- sit in the same
 * container, and the reply reads as one surface with objects in it instead of
 * a stack of panels. (The old frame was a raised card with a drop shadow,
 * which is the construction the artifact system explicitly grew out of.)
 *
 * The head sits on that same ground behind a hairline -- an internal divider,
 * not an edge -- because a frame with controls needs somewhere for them to
 * live that is not floating over the code.
 */
export function BlockFrame({
  glyph,
  label,
  meta,
  actions,
  scrollHeight = 'max-h-96',
  bodyClassName,
  children,
}: {
  /** The mark before the label, if the block has one -- a file-type glyph. */
  glyph?: ReactNode
  /** What this block is: a path for code, a name for prose. */
  label: ReactNode
  /** Secondary detail -- a line count. Left of the controls. */
  meta?: ReactNode
  /**
   * Controls. Always visible.
   *
   * They used to fade in on hover, on the reasoning that a reader should not
   * see chrome they are not reaching for. That was wrong for these: copy is the
   * single most common thing anyone does to a code block, and a control you
   * have to discover by hovering is one most people never find. They are quiet
   * enough at rest to sit there permanently.
   */
  actions?: ReactNode
  /**
   * How tall the body may get before it scrolls inside itself. A cap is not a
   * preview -- everything below it is still on the page, one scroll away --
   * but a block without one hands the column to whatever the model emitted.
   */
  scrollHeight?: string
  /** Extra classes for the body, for content that pads or scrolls itself. */
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <div className="my-5 w-full min-w-0 overflow-hidden rounded-xl bg-surface-sunken">
      <div className="flex items-center gap-2 border-b border-hairline py-1.5 pl-3 pr-2">
        {glyph}
        <span className="min-w-0 truncate text-caption font-medium text-foreground">{label}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {meta ? (
            <span className="shrink-0 pr-0.5 text-caption tabular-nums text-muted-foreground">
              {meta}
            </span>
          ) : null}
          {actions}
        </div>
      </div>

      {/* The frame's own scroller: the thumb is held back by the frame's
          radius on each axis, so it stops before the curve instead of
          running into it -- the same courtesy the app's page scroller and
          the bounded menus get. */}
      <div className={cn('studio-scroll-frame min-w-0', scrollHeight, 'overflow-auto', bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
