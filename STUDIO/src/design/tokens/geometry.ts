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
 * that feels administrative. The window's own corner is `--window-radius` in
 * styles/layout.css, because the CSS is the only thing that paints it.
 */
export const RADIUS = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  /** A capsule. The one radius that is concentric with anything. */
  pill: 9999,
} as const

/** Spacing used by native and animated shell geometry. CSS layout roles live in styles/layout.css. */
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
  /** Available shell width before the sidebar floats over the page. */
  compactWidth: 900,
  /** Page budget before the workspace becomes an overlay. */
  minPageWidth: 520,
  railGutter: SPACE.xl,

  /**
   * The top strip. Transparent: no fill, no hairline. Content scrolls under it
   * and is masked by a gradient rather than hidden behind a bar.
   */
  topStrip: {
    height: 40,
    paddingInline: SPACE.lg,
  },

  /** Window controls. Monochrome — see `TrafficLights`. */
  trafficLight: { size: 11, gap: SPACE.md },

  sidebar: {
    /** Icon-only rail. Project marks, no labels; the name is a tooltip. */
    railWidth: 52,
    /** Expanded, showing conversation titles. */
    expandedWidth: 236,
  },

  /**
   * How far the scroll thumb is held back from each end of its track.
   *
   * The transcript fades into the surface at the top and bottom, and a thumb
   * that runs the full height slides underneath those fades and half
   * disappears. Insetting the track keeps the thumb inside the legible band
   * without taking away any scroll range — the content still reaches both
   * ends, only the indicator is shorter.
   *
   * Two values, because the ends are not symmetrical, and each is the sum of
   * what is actually painted over the scroller there rather than a number
   * picked to look about right. A single 44 cleared the strip and then stopped
   * one pixel inside the gradient beneath it, so the thumb still faded out at
   * the top — the bug that outlived several attempts to tune the one number.
   *
   *   top     `topStrip.height` (solid) + 20 (the gradient below it)
   *   bottom  40 (the composer's gradient; the composer itself paints no fill)
   *
   * Mirrored by `--scroll-inset-top` / `--scroll-inset-bottom` in `styles/tokens.css`,
   * which is what `.studio-scroll-inset` actually reads.
   */
  scrollbarInset: { top: 40 + 20, bottom: 40 },
} as const

/** The composer: one rounded box, with the field above its row of tools. */
export const COMPOSER = {
  /** The air between the box and a menu opening off it. */
  menuOffset: SPACE.lg,
  /**
   * How far from the field's ends text dissolves while there is more of it to
   * scroll to, and how far the scrollbar's thumb is held back from them.
   */
  edgeFade: 14,
  /** Grow to about eight lines, then scroll inside. */
  maxHeight: 184,
} as const

/**
 * A generated picture or clip in the transcript.
 *
 * Every frame is the shape of its picture, and the whole set stands under
 * one height: a single picture is at most `maxHeight` tall, and several share
 * it in rows of two. So a wide picture is wide, a tall one is narrow, and
 * neither is stretched to the measure - at Family A's 720px window the old
 * 480px cap and full-width rows let one picture take most of the screen and
 * a portrait fill the column with blurred bands.
 *
 * The default ratio is the reservation for a frame whose picture has not
 * arrived and whose call named no ratio. 4:3 is the least wrong guess: most
 * models' default is square or near it, and a 4:3 box turning into a square
 * moves the transcript less than a 16:9 one would.
 */
export const MEDIA_FRAME = {
  maxHeight: 300,
  /** Two pictures side by side share a shorter row than one alone. */
  pairHeight: 240,
  defaultRatio: 4 / 3,
  /** Between frames in one artifact, and between rows of them. */
  gap: SPACE.sm,
  /** A picture alone; the composer's own corner. */
  radius: 18,
  /** A picture in a set, a step smaller as the frames are. */
  setRadius: 14,
} as const
