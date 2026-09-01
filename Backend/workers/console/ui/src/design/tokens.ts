/**
 * The motion vocabulary.
 *
 * Every animation in the console picks from here. Not because variety is bad,
 * but because unrelated variety is: when a control springs at one stiffness, a
 * popover fades at an unrelated duration and a view crossfades at a third, the
 * interface stops feeling like one object.
 *
 * Three rules behind the numbers, the same three STUDIO uses:
 *
 *   1. Things that move because you moved them use a spring. The physics is
 *      the feedback.
 *   2. Things that appear or vanish use a duration and an ease-out. There is
 *      no physical object to model, so a spring only adds latency.
 *   3. Nothing exceeds ~300ms. Past that a transition reads as a wait.
 *
 * The durations are deliberately the same three values as `--duration-fast`,
 * `--duration-base` and `--duration-slow` in `styles.css`, because a CSS
 * transition and a Framer animation on the same interaction must not disagree.
 * Change one, change the other.
 */

/** Ease-out quint. The house curve: fast start, long settle. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  /** A state change on something already visible — hover, a chip. */
  fast: 0.12,
  /** An element entering or leaving — popovers, view crossfades. */
  base: 0.18,
  /** A whole surface changing. */
  slow: 0.26,
} as const;

/** Small parts: popovers, chips, the segmented thumb, the nav chip. */
export const SPRING_SNAPPY = { type: "spring", stiffness: 460, damping: 36, mass: 0.6 } as const;

/** Surfaces that scale in: a menu panel. */
export const SPRING_SURFACE = { type: "spring", stiffness: 380, damping: 30, mass: 0.8 } as const;

export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const;

/**
 * A surface arriving. The console's pages are siblings — four tabs at one
 * depth, with no hierarchy between them — so this is a crossfade with a short
 * rise and no direction. STUDIO's push/pop vocabulary exists because its
 * surfaces nest; ours do not, and borrowing directional motion for a lateral
 * move is the specific thing that reads as a glitch rather than a choice.
 */
export const SURFACE = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const;

/**
 * A height collapse — a disclosure row, an expanded event.
 *
 * `height: auto` is measured every frame, so this is the one place a spring is
 * genuinely wrong: overshoot on a measured height reflows everything below it.
 */
export const COLLAPSE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const;
