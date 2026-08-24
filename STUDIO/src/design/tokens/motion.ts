/**
 * The motion vocabulary.
 *
 * Every animation picks from here. Not because variety is bad, but because
 * unrelated variety is: when a sheet springs at one stiffness, a popover fades
 * at an unrelated duration and a control crossfades at a third, the app stops
 * feeling like one object.
 *
 * Three rules behind the numbers:
 *
 *   1. Things that move because you moved them use a spring. The physics is the
 *      feedback.
 *   2. Things that appear or vanish use a duration and an ease-out. There is no
 *      physical object to model, so a spring only adds latency.
 *   3. Nothing exceeds ~300ms. Past that a transition reads as a wait.
 *
 * Reduced motion is handled once, at the root, by `<MotionConfig
 * reducedMotion="user">`. CSS transitions are covered by the matching media
 * query in `index.css`. Never branch on the preference inside a component.
 */

/** Ease-out quint. The house curve: fast start, long settle. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const DURATION = {
  /** A state change on something already visible — hover, a chip. */
  fast: 0.12,
  /** An element entering or leaving — popovers, view crossfades. */
  base: 0.18,
  /** A whole surface changing — the palette, a sheet. */
  slow: 0.26,
} as const

/** Panels that track a drag or a toggle: the sidebar and anything paced to it. */
export const SPRING_PANEL = { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 } as const

/** Small parts: popovers, chips, the segmented thumb. */
export const SPRING_SNAPPY = { type: 'spring', stiffness: 460, damping: 36, mass: 0.6 } as const

/** Surfaces that scale in: dialogs, the palette. */
export const SPRING_SURFACE = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as const

export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/**
 * The view transition: a short rise on enter, a short fall on exit.
 *
 * 6px, not 16. The distance is a hint that something replaced something else,
 * not a journey.
 */
export const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/**
 * A height collapse — a thinking block, a disclosure.
 *
 * `height: auto` is measured every frame, so this is the one place a spring is
 * genuinely wrong: overshoot on a measured height reflows everything below it.
 */
export const COLLAPSE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/** Capped stagger. Uncapped, the last row of a long list arrives late enough to read as lag. */
export function staggerDelay(index: number): number {
  return Math.min(index * 0.025, 0.2)
}

/**
 * The startup splash — the one place motion is allowed to be slow.
 *
 * The ~300ms ceiling above governs interaction, where every millisecond is
 * latency the user pays for twice. The splash is not interaction: it plays
 * once, before anything can be clicked, and its job is the brand arriving
 * rather than getting out of the way. The mark assembles on its own clock (see
 * `StudioMark`'s entrance), holds a beat, and leaves on a fade. The minimum is
 * what that entrance plus the beat costs — any shorter and the mark would be
 * interrupted mid-arrival.
 */
export const SPLASH = {
  /** Minimum time the splash is on screen, entrance included. */
  minDurationMs: 1800,
  /**
   * The fade that hands the window to the app underneath.
   *
   * Longer than the mark's own exit, so the two are sequenced rather than
   * simultaneous: the brand rises away, and the surface it was standing on
   * follows it out. Fading both at one rate is an image being switched off,
   * which is what the handover used to feel like.
   */
  exitDuration: 0.62,
  /** The mark, leaving first. */
  markExitDuration: 0.34,
  /** How long the app settles in as the splash fades. Deliberately slow. */
  revealDuration: 0.7,
} as const
