import { useContext } from 'react'

import { IconStateContext, type IconState } from '@/components/icons/Icon'
import { ICON, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The marks that are drawn here rather than taken from the library.
 *
 * ---- Why any at all --------------------------------------------------------
 *
 * Lucide ships finished components, so there is nothing addressable inside a
 * mark. That is fine for almost everything -- a chevron turning, send lifting,
 * the plus becoming a cross are all transforms of a whole glyph -- but it
 * cannot express a mark whose meaning lives in one part that moves while the
 * rest holds still.
 *
 * The panel toggle is the one control where that matters. It is the most-used
 * button in the window and it carries no label, so its whole job is to say
 * which of two states the layout is in. A frame with a divider says it
 * natively: the divider is the sidebar's edge, and moving it *is* the state
 * change. The alternatives were both tried and both rejected -- moving the
 * whole mark makes the button look unstable under the cursor, and darkening it
 * makes a quiet control the loudest pixel on screen.
 *
 * This is also what pays for the rule in `IconButton`. The chip carries state
 * and the glyph never darkens, so something has to replace the contrast that
 * was removed. A part that moves says more than a mark that gets blacker.
 *
 * ---- Why two overlaid SVGs rather than one animated part -------------------
 *
 * This is the part worth reading, because the obvious construction does not
 * work and fails without a word.
 *
 * The natural approach is one SVG with a `motion.line` inside it, driven by a
 * variant. `Icon.tsx` even supports it. It produced a divider that sat still in
 * every state across three separate attempts, for two stacked reasons:
 *
 *   1. `transform-box: fill-box` resolves against the shape's own bounding box,
 *      and a vertical line's box has zero width. Chromium silently drops a
 *      transform on a degenerate box.
 *   2. On an SVG motion component, framer reads `x` as the element's *attribute*
 *      of that name -- `rect`, `image` and `text` all have one. `line` does not,
 *      so the value went to a meaningless attribute and no transform was ever
 *      produced.
 *
 * Both are fixed in `Icon.tsx` now, and the part still did not move. Framer was
 * verified as receiving the right state -- the context reads `on`, the variant
 * is correct -- and it rendered `transform: none` at every level tried: `line`,
 * a nested `svg`, and a `g`. Replacing framer with a CSS transition on the `g`
 * did not help either: the inline style updated to `translateX(0px)` while the
 * computed transform stayed where it started.
 *
 * So this stops trying to move anything inside the SVG. The frame is vector,
 * because it has a curve. The divider is an HTML element, because a div with a
 * position is the best-defined thing in the browser and nothing about it can
 * fail quietly. See the comment at the element itself.
 */




const STEP_PX: Record<Exclude<IconSize, 'text'>, number> = {
  xs: ICON.xs,
  sm: ICON.sm,
  md: ICON.md,
  lg: ICON.lg,
}

/**
 * Open, the divider sits where the expanded sidebar's edge is. Closed, it
 * retreats to the frame's left.
 *
 * Hover deliberately does not move it. A preview on hover made the mark
 * restless: the divider twitched every time the pointer crossed the button on
 * its way somewhere else, which is most of the times it is crossed. The
 * movement means "the panel changed", so it should happen when the panel
 * changes and at no other time -- the chip already answers "you are here".
 */
const SLIDE_X: Record<IconState, number> = {
  rest: 0,
  hover: 0,
  press: 0,
  on: 3.4,
  live: 0,
}

const FRAME = 'M4.6 3.2h6.8a2.4 2.4 0 0 1 2.4 2.4v4.8a2.4 2.4 0 0 1-2.4 2.4H4.6a2.4 2.4 0 0 1-2.4-2.4V5.6a2.4 2.4 0 0 1 2.4-2.4Z'

export function SidebarToggle({
  size = 'text',
  state,
  className,
  style,
}: {
  size?: IconSize
  state?: IconState
  className?: string
  style?: React.CSSProperties
}) {
  const inherited = useContext(IconStateContext)
  const active = state ?? inherited
  const box = size === 'text' ? '1.1em' : `${STEP_PX[size]}px`

  const svg = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  return (
    <span
      aria-hidden
      className={cn('studio-icon relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: box, height: box, ...style }}
    >
      <svg {...svg} className="absolute inset-0 size-full">
        <path d={FRAME} />
      </svg>

      {/* The divider is an HTML element, not part of the SVG.

          Worth explaining, because it looks like the odd choice and it is the
          only one that actually paints. Moving a shape *inside* an SVG was
          attempted at every level -- `line`, nested `svg`, `g`, driven both by
          framer variants and by a CSS transition -- and each failed differently
          and silently: framer writes a positional value to an SVG element's
          same-named attribute rather than producing a transform, `fill-box`
          collapses on a shape with no width, and a transition on a `<g>`
          transform never settles in Chromium (the inline style updated to
          `translateX(0px)` while the computed transform stayed where it began).

          Outside the SVG none of that exists. A div with a transform is the
          best-defined thing in the browser. The frame stays vector because it
          has a curve; the divider is a straight bar 1.2px wide, which is the
          same weight the stroke paints at, so the two read as one mark.

          Percentages keep it locked to the frame at any size: the mark is
          drawn on a 16-unit grid, so 35% is x=5.6 and the bar spans the frame's
          interior height exactly. */}
      <span
        aria-hidden
        className="absolute rounded-full bg-current"
        style={{
          // `left`, not a transform. A percentage transform resolves against
          // the element's own width, and this element is 1.2px wide -- so the
          // whole travel would have been a quarter of a pixel. `left` resolves
          // against the containing box, which is the frame.
          left: `${((5.6 + SLIDE_X[active]) / 16) * 100}%`,
          top: '20%',
          height: '60%',
          width: 1.2,
          transition: 'left var(--duration-base) var(--ease-out-quint)',
        }}
      />
    </span>
  )
}
