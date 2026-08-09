/**
 * Shell geometry — the single source of truth.
 * Change a number here and every chrome layer stays aligned.
 *
 * Reference: `archive/STUDIO/src/app/shell/workspaceShell.css:19` defines
 * `--studio-topbar-height: 46px` and `--studio-topbar-control: 28px`,
 * with traffic lights at `left:14, gap:8` and left toggle at `left:72`
 * (14 + 3*10 + 2*8 + 12 gap) so they share one 46px band without overlap.
 * STUDIO uses a 36px band (trafficLight.height === dock.bandHeight) — same
 * principle, just denser. The left rail toggle is offset to 72 to not clash.
 */
export const SHELL = {
  /** Corner radius of the app panel. With a transparent OS window this CSS
   *  radius is the visible window shape; DWM rounds the outer silhouette. */
  frameRadius: 12,
  /** Height of the invisible drag strip at the very top edge (px). */
  hotZoneHeight: 5,
  /** macOS-style window controls — fixed top-left, flex centered in top bar. */
  trafficLight: { size: 10, gap: 8, left: 14, height: 36 },
  /** Edge brackets framing the content area; wide enough for a 24px toggle. */
  rail: {
    width: 32,
    /** Vertical padding when rail is in-flow (legacy); top-bar toggles now use `topBarHeight`. */
    paddingTop: 8,
    /** Left toggle offset to clear traffic lights: 14 + 46 lights width + 12 gap = 72 (ref). */
    leftToggleLeft: 72,
    /** Right toggle offset from viewport right edge (ref: right 14). */
    rightToggleRight: 14,
  },
  /** Floating dock: the top band it centres itself in, and the pill's own
   *  resting height. The band matches `trafficLight.height` so the dock and
   *  the window controls share one top chrome row. */
  dock: { bandHeight: 36, pillMinHeight: 35 },
  /** Single top chrome row height — traffic lights, dock and rail toggles all center here. */
  get topBarHeight() {
    return this.trafficLight.height
  },
} as const
