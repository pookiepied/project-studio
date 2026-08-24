import { forwardRef, useContext } from 'react'
import { motion, type Variants } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { IconStateContext, type IconState } from '@/components/icons/Icon'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * Binds a Lucide mark to one of the app's concepts.
 *
 * ---- Why a library, after drawing our own ---------------------------------
 *
 * The hand-drawn set was built on a 16-unit grid so its coordinates landed on
 * whole pixels, which is genuinely the right way to draw for 14px. What it
 * could not do was vary detail with size: every mark painted a ~1.2px stroke
 * whatever it was drawn at, so the dense glyphs — the gear, the paperclip —
 * closed their own gaps and filled in. A mark whose interior gaps fall below
 * its stroke width is not a drawing problem that can be nudged; it is one glyph
 * being asked to serve two sizes.
 *
 * Lucide is drawn on a 24-unit grid with a consistent stroke and enough
 * internal air to survive being set at 14. It is softer than a hand-gridded
 * mark at that size, which is the trade being made deliberately.
 *
 * ---- What is kept -----------------------------------------------------------
 *
 * The concept map, the sizing rule and the motion contract are ours and do not
 * change. `Icons.foo` still takes `size` and `state`, still sizes from the text
 * it sits in, and still reads hover and press from the control around it
 * through `IconStateContext`. Call sites are untouched by the swap, which is
 * the whole reason the registry was a map of concepts rather than a pile of
 * SVGs.
 *
 * ---- Stroke -----------------------------------------------------------------
 *
 * The painted line is held at ~1.2px at every step by `vector-effect:
 * non-scaling-stroke` (applied in `index.css` via `.studio-icon`), which reads
 * the width in device pixels rather than viewBox units. Without it the same
 * mark paints 1.17px in a menu and 1.83px at the `lg` step, and the set stops
 * reading as one weight.
 *
 * Lucide's own `absoluteStrokeWidth` solves the same problem and cannot be used
 * here: it divides by a numeric `size`, and this adapter sizes the mark from the
 * text around it, so `size` is `100%` and the division yields NaN.
 */

/** A mark sits about a tenth above its text. See the note in `Icon.tsx`. */
const TEXT_RELATIVE = '1.1em'

interface LucideIconProps {
  size?: IconSize
  /** Overrides the state inherited from the surrounding control. */
  state?: IconState
  className?: string
  style?: React.CSSProperties
}

/**
 * Fills in states the caller did not declare so a mark always has somewhere
 * definite to return to. Without it a glyph animated to a missing label stays
 * wherever it was, and poses accumulate across hover and press.
 */
function complete(v: Variants | undefined): Variants | undefined {
  if (!v) return undefined
  const rest = v.rest ?? {}
  return {
    rest,
    hover: v.hover ?? rest,
    press: v.press ?? v.hover ?? rest,
    on: v.on ?? rest,
    live: v.live ?? rest,
  }
}

export function fromLucide(Mark: LucideIcon, name: string, variants?: Variants) {
  const resolved = complete(variants)

  const Concept = forwardRef<HTMLSpanElement, LucideIconProps>(function Concept(
    { size = 'text', state, className, style },
    ref,
  ) {
    const inherited = useContext(IconStateContext)
    const active = state ?? inherited
    const box = size === 'text' ? TEXT_RELATIVE : ICON_STEP[size]

    return (
      <motion.span
        ref={ref}
        aria-hidden
        // The motion lives on a wrapper rather than on the SVG's parts. Lucide
        // ships finished components, so there is nothing addressable inside
        // them — and everything this app actually animates (a chevron turning,
        // retry winding up, the plus becoming a cross) is a transform of the
        // whole mark anyway.
        initial={resolved ? 'rest' : undefined}
        animate={resolved ? active : undefined}
        variants={resolved}
        className={cn('studio-icon inline-flex shrink-0 items-center justify-center', className)}
        style={{ width: box, height: box, ...style }}
      >
        <Mark size="100%" strokeWidth={1.2} />
      </motion.span>
    )
  })

  Concept.displayName = name
  return Concept
}
