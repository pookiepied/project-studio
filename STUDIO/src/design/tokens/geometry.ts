import { DEFAULT_UI_SIZE } from './typography'

/**
 * Radius, spacing, and shell geometry.
 *
 * ---- The concentric rule --------------------------------------------------
 *
 * A container of radius R with padding P holds children of radius R - P. Follow
 * it and corners run parallel; break it and the inner arc bulges past the outer
 * one, which is the specific thing that reads as "pasted on".
 *
 * Every nested pair in the app is written out below so the arithmetic is done
 * once, here, rather than guessed at each call site.
 */

/*
 * Softened by two pixels across the middle of the scale.
 *
 * The steps were drawn tight enough that a row, a menu and a chip all read as
 * rectangles with the corners taken off rather than as soft objects, and at
 * this size that is the difference between an interface that feels calm and one
 * that feels administrative. The window's own 20 is unchanged -- it was already
 * the softest thing on screen, and everything else was failing to agree with
 * it.
 */
export const RADIUS = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  /** The window itself. Every other radius is derived from this one. */
  window: 20,
  /** A capsule. The one radius that is concentric with anything. */
  pill: 9999,
} as const

/**
 * Control heights, as multiples of the interface text size.
 *
 * The ratios are `--control-*` in `index.css`, and this is the numeric mirror
 * of them: Framer cannot spring a `calc()`, so the handful of controls that
 * animate a height or a radius need real numbers. Derived rather than restated,
 * so the two cannot drift the way the type scale and the geometry did -- which
 * is the whole reason this block exists.
 *
 * The multiplication comes before the division on both sides, so the steps are
 * exact integers at the default rather than a rounded decimal here and an
 * unrounded `calc()` there.
 *
 * That drift is worth naming, because it is what "changing the font size did
 * nothing" actually was. Text was driven by `--ui-size`; these numbers were
 * fixed px from when the interface text was 14. Nothing recomputed them at 12,
 * so every box kept the proportions of a larger scale and a size preference
 * moved the text while the sidebar, the chrome and the composer stood still.
 */
export const CONTROL = {
  /** Compact: row overflow buttons, menu affordances. */
  sm: (DEFAULT_UI_SIZE * 2) / 1,
  /** The default: icon buttons in the chrome, and the composer's row. */
  md: (DEFAULT_UI_SIZE * 7) / 3,
  /** The largest round control in the chrome. */
  lg: (DEFAULT_UI_SIZE * 8) / 3,
  /** The stage control: voice mode's transport, and nothing else. */
  xl: (DEFAULT_UI_SIZE * 11) / 3,
} as const

/** The 4px spacing grid. Nothing in the app uses a value that is not here. */
const SPACE = {
  none: 0,
  hair: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  '3xl': 32,
} as const

export const SHELL = {
  /** Corner radius of the window, matched by the DWM preference in Rust. */
  windowRadius: RADIUS.window,

  /**
   * The top strip. Transparent: no fill, no hairline. Content scrolls under it
   * and is masked by a gradient rather than hidden behind a bar.
   */
  topStrip: {
    height: 40,
    paddingInline: SPACE.lg,
  },

  /** Window controls. Monochrome -- see `TrafficLights`. */
  trafficLight: { size: 11, gap: SPACE.md },

  sidebar: {
    /** Icon-only rail. Project marks, no labels; the name is a tooltip. */
    railWidth: 52,
    /** Expanded, showing conversation titles. */
    expandedWidth: 236,
  },

  /**
   * Reading measure for the transcript and the composer.
   *
   * 46 em of body text, which is about 76 characters -- the upper end of
   * comfortable prose. Stated against `--text-body` because the measure has to
   * track the text it is measuring; the root font-size is the layout grid now,
   * not the text size. The composer shares it so a reply lands exactly as wide
   * as the field that produced it.
   */
  measure: 'calc(var(--text-body) * 46)',

  /** Shared content gutter, so nothing sits at a different x between views. */
  gutter: SPACE['2xl'],

  /**
   * How far the scroll thumb is held back from each end of its track.
   *
   * The transcript fades into the surface at the top and bottom, and a thumb
   * that runs the full height slides underneath those fades and half
   * disappears. Insetting the track keeps the thumb inside the legible band
   * without taking away any scroll range -- the content still reaches both
   * ends, only the indicator is shorter.
   *
   * Two values, because the ends are not symmetrical, and each is the sum of
   * what is actually painted over the scroller there rather than a number
   * picked to look about right. A single 44 cleared the strip and then stopped
   * one pixel inside the gradient beneath it, so the thumb still faded out at
   * the top -- the bug that outlived several attempts to tune the one number.
   *
   *   top     `topStrip.height` (solid) + 20 (the gradient below it)
   *   bottom  40 (the composer's gradient; the composer itself paints no fill)
   *
   * Mirrored by `--scroll-inset-top` / `--scroll-inset-bottom` in `index.css`,
   * which is what `.studio-scroll-inset` actually reads.
   */
  scrollbarInset: { top: 40 + 20, bottom: 40 },
} as const

/*
 * The composer's height, and why it is no longer a number of its own.
 *
 * It used to be 52, and 52 was never chosen for the text -- it was 32px round
 * controls plus 10px of padding, twice. The field was sized by its buttons, and
 * the text inside it had no say at all: setting the composer to 8px or 16px
 * left the capsule exactly 52 tall either way. That is why every attempt to fix
 * "the field is huge and the text is tiny" by changing a font size failed. The
 * font was never in the equation.
 *
 * Measured, the field held 11px text in a 52px box -- 4.7x. Every other control
 * in the app sat between 2.2x and 2.4x. It was not that the composer looked
 * wrong next to the text; it was the one control in the interface not drawn to
 * the same proportion as the rest of it.
 *
 * Both inputs are tokens now, so the height is an outcome rather than a
 * constant: the control row is `CONTROL.md`, the same step every other icon
 * button uses, and the padding is one step of the spacing grid. At the default
 * that lands on 40 -- which is also `SHELL.topStrip.height`, so the field and
 * the window's chrome finally agree without either being told to.
 */
const COMPOSER_PADDING_BLOCK = SPACE.sm
const COMPOSER_RESTING_HEIGHT = CONTROL.md + COMPOSER_PADDING_BLOCK * 2

/** The composer, which is a capsule when single-line and a rounded box when not. */
export const COMPOSER = {
  /** Above and below the control row. The resting height derives from it. */
  paddingBlock: COMPOSER_PADDING_BLOCK,
  /** Height of the resting single-line field. Radius is half of this. */
  restingHeight: COMPOSER_RESTING_HEIGHT,
  /**
   * The single-line radius: half the field's own height, so it is a capsule.
   *
   * A real number rather than `RADIUS.pill`, and this is the fix for the
   * reshape-on-paste that survived three other attempts.
   *
   * `pill` is 9999. Animating 9999 -> 18 is a linear interpolation through
   * absurd values, and border-radius is clamped to half the box at paint time,
   * so nothing visible happens for most of the transition -- the field sits as
   * a capsule through ~99% of the duration and then collapses to a box in the
   * last few frames. That late collapse, arriving after the height had already
   * changed, is exactly the "it changes shape and then reverts" the user kept
   * seeing. The measurement was never late; the interpolation was.
   *
   * From 26 to 18 the transition is short, monotonic and visible the whole way,
   * which is what makes it read as one object relaxing rather than two shapes
   * swapping. (Half of 52 exactly -- it only adds up now that the rem grid
   * paints at nominal; for as long as the root carried the text size, the
   * field's real height was ~42px and this number described a box it never
   * sat on.)
   *
   * Half of the height rather than a hand-written copy of half the height --
   * the capsule stays a capsule when the height moves, instead of the two
   * needing to be remembered together.
   */
  restingRadius: COMPOSER_RESTING_HEIGHT / 2,

  /** Past this the field is a box, not a capsule. */
  multilineRadius: RADIUS.xl,
  /** Grow to about eight lines, then scroll inside. */
  maxHeight: 184,
  paddingInline: SPACE.sm,
  /** Every round control inside the field -- the same step as the chrome's. */
  controlSize: CONTROL.md,
} as const
