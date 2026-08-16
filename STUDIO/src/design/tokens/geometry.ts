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
   * 44rem is about 76 characters at 14px, the upper end of comfortable prose.
   * The composer shares it so a reply lands exactly as wide as the field that
   * produced it.
   */
  measure: '44rem',

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
   */
  scrollbarInset: 44,
} as const

/** The composer, which is a capsule when single-line and a rounded box when not. */
export const COMPOSER = {
  /** Height of the resting single-line field. Radius is half of this. */
  restingHeight: 52,
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
   * From 24 to 18 the transition is short, monotonic and visible the whole way,
   * which is what makes it read as one object relaxing rather than two shapes
   * swapping.
   */
  restingRadius: 24,

  /** Past this the field is a box, not a capsule. */
  multilineRadius: RADIUS.xl,
  /** Grow to about eight lines, then scroll inside. */
  maxHeight: 184,
  paddingInline: SPACE.sm,
  /** Every round control inside the field. */
  controlSize: 32,
} as const
