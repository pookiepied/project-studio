/**
 * The app's motion vocabulary.
 *
 * Every animation in Studio picks from here. Not because variety is bad, but
 * because *unrelated* variety is: when a panel springs at one stiffness, a
 * popover fades at an unrelated duration and a tab crossfades at a third, the
 * app stops feeling like one object. Shared timing is most of what makes
 * software feel considered.
 *
 * Three rules behind the numbers:
 *
 *   1. Things that move because you moved them use a spring. Panels, drag
 *      handles, segmented thumbs — the physics is the feedback.
 *   2. Things that appear or vanish use a duration and an ease-out. There is
 *      no physical object to model, so a spring just adds latency.
 *   3. Nothing exceeds ~300ms. Beyond that a transition stops reading as
 *      responsive and starts reading as a wait.
 *
 * Reduced motion is handled once, at the root, by `<MotionConfig
 * reducedMotion="user">` in `App.tsx` — it strips transforms and keeps
 * opacity, which is the right fallback for all of these. CSS transitions are
 * covered by the matching media query in `index.css`. Do not add per-component
 * reduced-motion branches; they will drift.
 */

/** Ease-out quint. The house curve: fast start, long settle. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** Symmetric ease for things that travel both ways at once. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const

/**
 * Durations, in seconds (Framer's unit).
 *
 *   fast  a state change on something already visible — hover, colour, a chip
 *   base  an element entering or leaving — popovers, view crossfades
 *   slow  a whole surface changing — the command palette, a dialog
 */
export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const

/**
 * The panel spring. Sidebar, context panel, and every toggle that has to keep
 * pace with one. Sharing it is what makes a button and its panel read as one
 * moving object rather than two coincidental animations.
 */
export const SPRING_PANEL = { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 } as const

/** Tighter spring for small parts: segmented thumbs, list reordering, chips. */
export const SPRING_SNAPPY = { type: 'spring', stiffness: 460, damping: 36, mass: 0.6 } as const

/** Softer spring for surfaces that scale in — dialogs, the command palette. */
export const SPRING_SURFACE = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as const

/** A plain fade. The default for anything that has no reason to travel. */
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
 * not a journey — a long slide makes every navigation feel like it cost
 * something. Paired with `AnimatePresence mode="wait"` so the two views never
 * overlap and the layout never jumps.
 */
export const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/**
 * A height collapse — sidebar disclosure, an expanding field.
 *
 * `height: auto` animations are measured every frame, so they are the one
 * place a spring is genuinely wrong: overshoot on a measured height reflows
 * everything below it. Duration and ease only.
 */
export const COLLAPSE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const

/**
 * Stagger for a list appearing at once — the projects grid.
 *
 * Capped, and low. An uncapped stagger means the last card in a long list
 * arrives noticeably late, which turns a nicety into a delay. 25ms a step,
 * never more than 200ms total.
 */
export function staggerDelay(index: number): number {
  return Math.min(index * 0.025, 0.2)
}
