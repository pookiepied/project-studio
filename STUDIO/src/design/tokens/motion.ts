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
 * How one surface hands over to the next.
 *
 * ---- Why direction, and why these distances -------------------------------
 *
 * A page used to enter with a 6px rise and no exit at all: the old surface was
 * destroyed in the same commit and the new one settled upward. On a switch
 * between conversations that read as "too basic", and entering Settings it
 * read as a rendering fault -- the rise compounded with a second rise the
 * page itself played, and both ran while the sidebar's spring was resizing
 * the container under them. Vertical motion on a horizontal handover is the
 * specific thing that looks like a glitch rather than a choice, because
 * nothing in the app's hierarchy is stacked vertically.
 *
 * The hierarchy *is* directional, though. Home sits under a project, a
 * project under its conversations, and Settings is the deepest layer of all.
 * So a handover is a move in that hierarchy, and the transition says which
 * way you moved:
 *
 * - **push** -- drilling in. The new surface arrives from the right while the
 *   old one leaves to the left, both sliding the way a page turns: forward.
 * - **pop** -- coming back. The mirror image. Back is a different motion from
 *   forward or the direction stops meaning anything.
 * - **sibling** -- a lateral move between things at the same depth, such as
 *   one conversation for another. No translation: a crossfade, with the
 *   sidebar's sliding selection chip carrying the sense of travel.
 *
 * The distances are a fraction of a column, not a journey: 32px in, 24px out.
 * Large enough to read as movement along an axis, small enough that the
 * surface arriving is readable before it finishes arriving. Both moves share
 * one duration and one curve, so the outgoing and incoming surfaces are
 * unmistakably the same event seen from two sides.
 *
 * `initial`/`animate`/`exit`/`transition` spread directly onto the keyed
 * surface element. The exiting element plays `exit` with the same transition,
 * which is why one object serves both roles.
 */
export type SurfaceMove = 'push' | 'pop' | 'sibling'

export const SURFACE_PUSH = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: DURATION.slow, ease: EASE_OUT },
} as const

export const SURFACE_POP = {
  initial: { opacity: 0, x: -32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24 },
  transition: { duration: DURATION.slow, ease: EASE_OUT },
} as const

export const SURFACE_SIBLING = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/** The transition preset for a move between surfaces. */
export function surfaceTransition(move: SurfaceMove) {
  return move === 'push' ? SURFACE_PUSH : move === 'pop' ? SURFACE_POP : SURFACE_SIBLING
}

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
