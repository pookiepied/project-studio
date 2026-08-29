import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { CONTROL } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The placeholder system: what a surface shows while its content is not there
 * yet.
 *
 * ---- What a placeholder is, and what it must never be ----------------------
 *
 * A skeleton is a picture of the layout, not a picture of the content. It
 * holds the shape a list, a row or a pane is about to occupy so that the
 * handover from waiting to loaded is a change of fill rather than a jump --
 * the reader's eye stays where it is. That is the whole promise, and it is
 * why the rules below are strict:
 *
 * - **Neutral.** The bone is `--selected` on the surface it sits on and its
 *   sweep is a faint tint of the foreground. No colour, ever: colour here
 *   would claim something about content nobody has seen, and a tinted
 *   rectangle where an image will be reads as a *failed* image (the argument
 *   `MediaArtifact` settled when it drew the first one).
 * - **Structural.** A placeholder is composed where the content is composed,
 *   from the same primitives and the same spacing, so a skeleton cannot drift
 *   from the layout it stands in for. A row's skeleton is built from the row's
 *   own padding and roles.
 * - **Honest.** Bones are `aria-hidden`; a loading region announces itself
 *   once through `role="status"` and a spoken label, and never pretends to be
 *   the content it previews. The transcript is excluded from all of this by a
 *   written decision of its own (`EarlierBoundary`): text that is about to be
 *   read does not get stand-ins.
 *
 * ---- One sweep, everywhere -------------------------------------------------
 *
 * The sweep lives here and nowhere else -- gradient, speed, distance. A page
 * that wants a different texture gets the same argument every other local
 * animation got before it was tokenised: variety in how the app says
 * "waiting" reads as several apps. Change the sweep here and every surface
 * changes with it.
 */

/**
 * The house sweep. A narrow band of foreground at 7%, crossing left to right:
 * the same recipe `MediaArtifact` drew first, promoted so the app has one.
 */
const SWEEP_GRADIENT =
  'linear-gradient(110deg, transparent 20%, color-mix(in oklab, var(--foreground) 7%, transparent) 50%, transparent 80%)'

export function Placeholder({
  sweep = true,
  className,
  style,
  children,
}: {
  /**
   * The moving highlight. Static bones -- a field that is holding a place
   * nobody is waiting on -- turn this off rather than animating without an
   * audience.
   */
  sweep?: boolean
  className?: string
  style?: CSSProperties
  /** Rendered above the sweep, centred: the icon a media field holds. */
  children?: ReactNode
}) {
  return (
    <span
      aria-hidden
      className={cn('relative block overflow-hidden bg-selected', className)}
      style={style}
    >
      {sweep ? (
        <motion.span
          className="absolute inset-0"
          style={{ background: SWEEP_GRADIENT }}
          animate={{ x: ['-60%', '60%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
        />
      ) : null}
      {children ? (
        <span className="relative flex size-full items-center justify-center">{children}</span>
      ) : null}
    </span>
  )
}

/**
 * A line of text, waiting to be text.
 *
 * The height is `1lh` -- one line box of whatever role the surrounding
 * composition carries -- so a skeleton row has exactly the height of the row
 * it becomes and a paragraph skeleton stacks without its own gaps. A bone that
 * inherits nothing lands on the root's line box, which is a reasonable bone
 * rather than a wrong one. Width comes from the call site, varied on purpose:
 * a column of equal bars reads as a pattern, not as a list.
 */
export function PlaceholderText({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <Placeholder className={cn('h-[1lh]', className)} style={style} />
}

/**
 * An icon tile, waiting to be one: the square the provider marks live in.
 *
 * `CONTROL.md`'s step rather than a literal, so the bone tracks the interface
 * scale the real mark will render at. `rounded-md` because that is the mark
 * tile's shape everywhere it appears.
 */
export function PlaceholderMark({
  size = CONTROL.md,
  className,
}: {
  size?: number | string
  className?: string
}) {
  return (
    <Placeholder
      className={cn('shrink-0 rounded-md', className)}
      style={{ width: size, height: size }}
    />
  )
}
