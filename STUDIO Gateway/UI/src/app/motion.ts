/**
 * Copied verbatim from STUDIO/src/app/motion.ts — keep in sync.
 * Gateway will merge into Studio, so motion vocabulary must be identical.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const
export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const
export const SPRING_PANEL = { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 } as const
export const SPRING_SNAPPY = { type: 'spring', stiffness: 460, damping: 36, mass: 0.6 } as const
export const SPRING_SURFACE = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as const
export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const
export const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const
export const COLLAPSE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE_OUT },
} as const
export function staggerDelay(index: number): number {
  return Math.min(index * 0.025, 0.2)
}
