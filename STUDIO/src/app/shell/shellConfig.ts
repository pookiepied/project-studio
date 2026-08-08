/**
 * Shell geometry — the single source of truth.
 * Change a number here and every chrome layer stays aligned.
 */
export const SHELL = {
  /** Corner radius of the app panel. With a transparent OS window this CSS
   *  radius is the visible window shape; DWM rounds the outer silhouette. */
  frameRadius: 12,
  /** Height of the invisible drag strip at the very top edge (px). */
  hotZoneHeight: 5,
  /** macOS-style window controls. */
  trafficLight: { size: 10, gap: 8, left: 14, height: 36 },
  /** Edge brackets framing the content area; wide enough for a 24px toggle. */
  rail: { width: 32, paddingTop: 8 },
  /** Floating dock: the top band it centres itself in, and the pill's own
   *  resting height. The band matches `trafficLight.height` so the dock and
   *  the window controls share one top chrome row. */
  dock: { bandHeight: 36, pillMinHeight: 35 },
} as const
