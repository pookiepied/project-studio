import { createContext, forwardRef, useContext, type ReactNode } from 'react'
import { motion, type SVGMotionProps, type Variants } from 'framer-motion'
import { ICON, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The icon renderer.
 *
 * ---- Why these are drawn here rather than installed -----------------------
 *
 * Every general-purpose icon library is drawn to survive being scaled from 16
 * to 96 pixels, which forces uniform stroke caps, perfectly circular bodies and
 * generous internal padding. Those choices are why a library set reads as a
 * sticker sheet at 14px: the marks are round, evenly weighted and slightly too
 * small inside their own box, so they float rather than sit on the baseline.
 *
 * System icon sets are drawn the other way round -- for one size, on that
 * size's pixel grid. That is the whole difference, and it cannot be recovered
 * by picking better names out of a library.
 *
 * So the rules here are fixed and few:
 *
 *   - A 16-unit box, so one unit is one pixel at the `md` step and coordinates
 *     land on real pixel boundaries instead of between them.
 *   - Optical weight held constant across the scale. A stroke drawn at 1.25
 *     units renders at 1.09px inside a 14px box and 1.56px inside a 20px one,
 *     so the same glyph would look thin in a menu and heavy in a header. The
 *     table below cancels that: the stroke is specified per step so the painted
 *     line is ~1.2px everywhere.
 *   - Round joins, so corners look drawn rather than cut. Round *caps* are used
 *     only on genuinely loose ends; a cap on a stroke that meets another shape
 *     is what makes a mark look inflated.
 *
 * ---- Motion ---------------------------------------------------------------
 *
 * An icon that only changes colour on hover is a picture of a control. The
 * marks here move, and the rule for when is narrow: motion either shows a
 * *state* the icon is now in, or previews the *action* it performs. Nothing
 * moves to be charming.
 *
 *   State     the plus becomes a cross when its menu is open; the chevron
 *             turns when its section opens; the sparkle keeps turning for
 *             exactly as long as the model is actually thinking.
 *   Action    send lifts the way the message will; the trash lid tilts;
 *             retry begins the rotation it is about to complete.
 *
 * Hover and press are not set on the icon. They arrive from the control that
 * owns it through `IconStateProvider`, which is why the mark reacts to the
 * whole 28px button rather than to the 14px glyph -- the difference between a
 * control that feels alive and one with a small dead hitbox in the middle.
 *
 * That context is deliberate rather than incidental. Framer will propagate a
 * `whileHover` label down a tree of motion components on its own, and relying
 * on it here does not work: a node only joins the variant tree if it has
 * `variants` of its own, so an icon whose motion lives on its parts silently
 * drops the label before it reaches them. It fails by doing nothing, which is
 * the worst way for an interaction to fail -- everything types, builds and
 * renders, and the interface is simply dead under the cursor. An explicit
 * context has one behaviour and can be tested.
 *
 * `MotionConfig reducedMotion="user"` at the app root turns all of this into
 * instant state changes for anyone who has asked the OS for that.
 *
 * `weight` is deliberately absent from the props. Selection is shown with
 * colour and background the way macOS does it, never by swapping an outline for
 * a solid, so a filled icon cannot arrive by accident.
 */

/** The variant names every glyph and control agrees on. */
export type IconState = 'rest' | 'hover' | 'press' | 'on' | 'live'

/**
 * How a control tells the marks inside it what is happening.
 *
 * Anything can drive icon motion by wrapping its children in this -- a row, a
 * menu item, a card -- not only `IconButton`. That matters because the reactive
 * area should be whatever the user perceives as the control, and that is
 * usually larger than the button element.
 */
const IconStateContext = createContext<IconState>('rest')

export function IconStateProvider({ state, children }: { state: IconState; children: ReactNode }) {
  return <IconStateContext.Provider value={state}>{children}</IconStateContext.Provider>
}

/**
 * Motion for one shape inside a mark.
 *
 * `origin` is a transform-origin inside the shape's own box, which is what
 * makes a trash lid hinge at its left end rather than pivot around its middle.
 */
export interface PartMotion {
  readonly v: Variants
  readonly origin?: string
}

/** A glyph is data, not markup -- see `assertUnique` in the registry. */
export interface Glyph {
  /** Stroked paths. */
  readonly p?: readonly string[]
  /** Filled paths. */
  readonly f?: readonly string[]
  /** Stroked circles: `[cx, cy, r]`. */
  readonly c?: readonly (readonly [number, number, number])[]
  /** Filled circles: `[cx, cy, r]`. */
  readonly fc?: readonly (readonly [number, number, number])[]
  /** Stroked rounded rects: `[x, y, w, h, radius]`. */
  readonly r?: readonly (readonly [number, number, number, number, number])[]
  /** Filled rounded rects: `[x, y, w, h, radius]`. */
  readonly fr?: readonly (readonly [number, number, number, number, number])[]
  /** Stroked lines: `[x1, y1, x2, y2]`. */
  readonly l?: readonly (readonly [number, number, number, number])[]
  /** Motion for the mark as a whole. */
  readonly m?: Variants
  /** Motion for one shape, keyed by list and index: `p0`, `l2`, `fr1`. */
  readonly parts?: Readonly<Record<string, PartMotion>>
}

export interface IconProps extends Omit<SVGMotionProps<SVGSVGElement>, 'ref' | 'variants' | 'initial' | 'animate'> {
  /**
   * Defaults to `text`: sized from whatever text the mark sits in.
   *
   * The named steps exist for marks with no text beside them. Reach for one
   * only in that case -- passing a step next to a label is how the pairing
   * drifts, and it drifted badly: nearly every icon in the app had been pinned
   * to `xs` regardless of its surroundings, so a 12px mark sat beside 13px text
   * everywhere and the interface read as undersized throughout.
   */
  size?: IconSize
  /**
   * Drives the glyph's own state.
   *
   * Left undefined the icon inherits hover and press from the control around
   * it. Setting it means this glyph has a state of its own -- a menu that is
   * open, a model that is thinking -- and that state outranks the pointer.
   */
  state?: IconState
}

/**
 * How much larger than its text a mark should be.
 *
 * A glyph is mostly negative space and an icon is a solid mark, so at equal
 * nominal size the icon reads bigger -- but at equal *painted* size it reads
 * smaller, because the letter beside it has ascenders and descenders using the
 * full em while the icon sits inside a square. About a tenth over is where the
 * two stop competing.
 *
 * Expressed in `em`, which is the entire point: the pairing is then a property
 * of the text an icon sits in rather than a number chosen at each call site.
 * Put a mark next to caption text and it is caption-sized; put the same mark in
 * a heading and it grows to match. Nothing to remember and nothing to keep in
 * sync -- see the note on `IconSize` for what the alternative cost us.
 */
const TEXT_RELATIVE = '1.1em'

/**
 * Absolute steps, in px, for marks that are *not* beside text -- an icon alone
 * in a square button, a mark in a rail.
 *
 * Deliberately px and deliberately inline. Tailwind's `size-*` utilities are
 * `rem`, and this app sets the root font-size to the user's UI size, so `rem`
 * is not 16px here -- at the 13px default every `rem` utility silently paints
 * at 0.8125x. That is what shrank `size-3` to 9.7px while its own width
 * attribute said 12, because the class beat the attribute. Any unit that
 * depends on the root is unusable for this, so the scale states px outright.
 */
const STEP_PX: Record<Exclude<IconSize, 'text'>, number> = {
  xs: ICON.xs,
  sm: ICON.sm,
  md: ICON.md,
  lg: ICON.lg,
}

/**
 * Fills in the states a glyph did not bother to declare, pointing them at
 * `rest`.
 *
 * Without this, animating to a label a glyph has no entry for leaves the shape
 * wherever it happened to be. A trash lid hovered, then pressed, would stay
 * tilted after the pointer left -- the icon would slowly accumulate poses. Each
 * missing state falling back to `rest` means every glyph always has somewhere
 * definite to return to.
 */
function complete(v: Variants | undefined): Variants {
  const rest = v?.rest ?? {}
  return {
    rest,
    hover: v?.hover ?? rest,
    press: v?.press ?? v?.hover ?? rest,
    on: v?.on ?? rest,
    live: v?.live ?? rest,
  }
}

/** Rotation and translation inside an SVG need an explicit box to act on. */
function partStyle(origin?: string) {
  return { transformBox: 'fill-box', transformOrigin: origin ?? 'center' } as const
}

const MPath = motion.path
const MCircle = motion.circle
const MRect = motion.rect
const MLine = motion.line

/** Completed part variants, computed once per glyph rather than per render. */
type Parts = Readonly<Record<string, { readonly v: Variants; readonly style: ReturnType<typeof partStyle> }>>

function prepareParts(glyph: Glyph): Parts {
  const out: Record<string, { v: Variants; style: ReturnType<typeof partStyle> }> = {}
  for (const [key, m] of Object.entries(glyph.parts ?? {})) {
    out[key] = { v: complete(m.v), style: partStyle(m.origin) }
  }
  return out
}

function shapes(glyph: Glyph, parts: Parts) {
  const part = (key: string) => parts[key]
  const solid = { fill: 'currentColor', stroke: 'none' } as const

  return (
    <>
      {glyph.f?.map((d, i) => {
        const m = part(`f${i}`)
        return <MPath key={`f${i}`} d={d} {...solid} variants={m?.v} style={m?.style} />
      })}

      {glyph.fr?.map(([x, y, w, h, r], i) => {
        const m = part(`fr${i}`)
        return (
          <MRect key={`fr${i}`} x={x} y={y} width={w} height={h} rx={r} {...solid} variants={m?.v} style={m?.style} />
        )
      })}

      {glyph.fc?.map(([cx, cy, r], i) => {
        const m = part(`fc${i}`)
        return <MCircle key={`fc${i}`} cx={cx} cy={cy} r={r} {...solid} variants={m?.v} style={m?.style} />
      })}

      {glyph.p?.map((d, i) => {
        const m = part(`p${i}`)
        return <MPath key={`p${i}`} d={d} variants={m?.v} style={m?.style} />
      })}

      {glyph.r?.map(([x, y, w, h, r], i) => {
        const m = part(`r${i}`)
        return <MRect key={`r${i}`} x={x} y={y} width={w} height={h} rx={r} variants={m?.v} style={m?.style} />
      })}

      {glyph.c?.map(([cx, cy, r], i) => {
        const m = part(`c${i}`)
        return <MCircle key={`c${i}`} cx={cx} cy={cy} r={r} variants={m?.v} style={m?.style} />
      })}

      {glyph.l?.map(([x1, y1, x2, y2], i) => {
        const m = part(`l${i}`)
        return <MLine key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} variants={m?.v} style={m?.style} />
      })}
    </>
  )
}

/** Binds a glyph to a concept. The only way icons enter the app. */
export function defineIcon(glyph: Glyph, name: string) {
  const animated = glyph.m !== undefined || glyph.parts !== undefined
  const rootVariants = animated ? complete(glyph.m) : undefined
  const parts = prepareParts(glyph)

  const Concept = forwardRef<SVGSVGElement, IconProps>(function Concept(
    { size = 'text', state, className, style, ...rest },
    ref,
  ) {
    const inherited = useContext(IconStateContext)
    // A state passed in outranks the pointer, so a menu that is open goes on
    // looking open while the cursor moves across it.
    const resolved = state ?? inherited

    const box = size === 'text' ? TEXT_RELATIVE : `${STEP_PX[size]}px`

    return (
      <motion.svg
        ref={ref}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        // The painted stroke stays ~1.2px at every size on its own: with
        // `non-scaling-stroke` the width is read in device pixels rather than
        // viewBox units, so it no longer has to be recomputed per step. That
        // matters more now that a mark can be any size its text happens to be,
        // and a per-step table could not have covered that.
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable={false}
        initial={animated ? 'rest' : undefined}
        animate={animated ? resolved : undefined}
        variants={rootVariants}
        style={{ width: box, height: box, ...style }}
        className={cn('shrink-0', className)}
        {...rest}
      >
        {shapes(glyph, parts)}
      </motion.svg>
    )
  })
  Concept.displayName = name
  return Concept
}

export type IconComponent = ReturnType<typeof defineIcon>
