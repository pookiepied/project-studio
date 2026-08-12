/**
 * Shell geometry — the single source of truth.
 *
 * The shell is a rounded window: a title bar across the top, and three rounded
 * panels floating on a padded tray beneath it — navigator | surface | context.
 *
 * ── On the corners ──────────────────────────────────────────────────────────
 *
 * The original shell had `frameRadius: 12`, `framePadding: 8`, `panelRadius:
 * 16`, and that combination is why the rounding never looked right. A panel
 * inset 8px inside a 12px corner has to be rounded at 12 − 8 = 4 for its curve
 * to run parallel to the window's; at 16 it bulges *past* the window corner and
 * the two arcs cross. Concentric radii is the rule Apple's hardware and macOS
 * both follow, and it is the whole reason a rounded thing sits inside another
 * rounded thing without looking pasted on.
 *
 * A previous attempt to fix this deleted the floating panels entirely and made
 * the shell one flat divided surface. That solved the arithmetic by removing
 * the design, which was the wrong trade — the floating panels are the app's
 * look. The correct fix is the other direction: open the window's corner up
 * until the concentric inner radius is generous.
 *
 *     windowRadius 20 − framePadding 8 = panelRadius 12   ✓ arcs run parallel
 *
 * So the panels came back, rounder than they were, and now the corners nest.
 *
 * ── On the title bar ────────────────────────────────────────────────────────
 *
 * The bar is a real flex row, not overlaid chrome, and that part is not
 * negotiable however the surfaces are styled. Previously the window controls
 * and both panel toggles were `position: fixed`, placed by arithmetic against
 * the viewport, while each panel laid out its own header with no knowledge of
 * them — so the left toggle landed on top of the sidebar's search button and
 * the right one on top of the project tab strip. Two layout systems describing
 * the same pixels will always eventually disagree. One flex row cannot.
 *
 * The bar sits *on the tray*, above the panels and transparent, so it reads as
 * part of the window frame rather than as a fourth panel.
 */
export const SHELL = {
  /** Corner radius of the window. Generous on purpose: this is the outer arc
   *  every inner corner is derived from, and it is the loudest single cue that
   *  this is a Mac-style app panel rather than a browser document. */
  windowRadius: 20,

  /** Inset between the window edge and the panels — the tray they float on. */
  framePadding: 8,

  /** Space between panels. Matches the frame padding so the tray reads as one
   *  continuous gutter rather than a border plus a separate gap. */
  panelGap: 8,

  /** Corner radius of every panel. Derived, not chosen: `windowRadius −
   *  framePadding`. Change either of those and change this to match. */
  panelRadius: 12,

  /** The title bar: window controls, location, branch, search, panel toggles. */
  titleBar: {
    height: 40,
    paddingLeft: 12,
    paddingRight: 10,
  },

  /** macOS-style window controls. Laid out inline in the title bar. */
  trafficLight: { size: 11, gap: 8 },

  /** The Studio navigator. Resizable — see `ChromeProvider`. */
  sidebar: {
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 420,
  },

  /** The context panel. Resizable on its own leading edge. */
  contextPanel: {
    defaultWidth: 296,
    minWidth: 240,
    maxWidth: 460,
  },

  /**
   * Drag handles are invisible until reached for: a transparent strip centred
   * on the gutter between two panels. Fitts's law wants the target wide; the
   * design wants nothing drawn there at rest.
   */
  resizeHandle: { hitWidth: 10 },

  /**
   * Shared content gutter.
   *
   * The home grid, the project surfaces and the chat column all inset by this,
   * so a title on one view sits at the same x as a title on the next and
   * navigation stops making the page jump sideways. Change it here only.
   */
  contentGutter: 24,
} as const
