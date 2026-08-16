/*
 * The icon registry: every glyph in the app, drawn once, bound to one concept.
 *
 * ---- The rule ------------------------------------------------------------
 *
 * One glyph means one thing. Reusing a glyph for two concepts is how an
 * interface stops being readable: once a mark means both "the model is
 * thinking" and "how hard it should think", neither reading is safe and the
 * user has to fall back on position to tell them apart.
 *
 * `assertUnique` enforces it at module load in development rather than merely
 * stating it, because this is a rule that fails silently -- a duplicate looks
 * fine in the diff that adds it and only becomes confusing three screens later.
 * It has already caught one real collision.
 *
 * Glyphs are data rather than markup precisely so that check can exist: two
 * concepts drawn from the same coordinates are equal by value, and a component
 * would not be.
 *
 * ---- The families that must not collide ----------------------------------
 *
 *   Thinking      a live event, happening now       a four-point sparkle
 *   Reasoning     a level on a dial                 a gauge
 *   Permission    what is allowed                   a shield
 *   Model         who you are talking to            provider marks
 *
 * ---- Drawing notes -------------------------------------------------------
 *
 * Everything sits in a 16-unit box on a 1.25-unit stroke, and most marks fill
 * roughly 11 of those 16 units. Library sets typically fill 9 or 10, which is
 * the second reason they look like stickers: the mark is adrift in its own box,
 * so it reads as an object placed on the row rather than type set into it.
 *
 * Verticals and horizontals land on .5 coordinates. A 1.25 stroke centred on
 * x=8 covers 7.375 to 8.625 and is painted across two columns of pixels at
 * partial opacity; centred on 8.5 it covers 7.875 to 9.125 and lands nearly
 * inside one. That is the whole of why these look sharp and a scaled-down
 * 24-unit library icon does not.
 */
import { defineIcon, type Glyph } from '@/components/icons/Icon'

/*
 * ---- Motion --------------------------------------------------------------
 *
 * Only some marks move, and each one that does is answering a question the
 * user is already asking. The plus is asked "is this menu open?"; the sparkle
 * is asked "is it still working?"; the trash is asked "what happens if I press
 * this?". A mark with no such question attached stays still -- an interface
 * where everything reacts to the pointer is noise, not craft.
 *
 * `hover` and `press` arrive from the surrounding control, not from the icon.
 */

/** Pointer feedback: fast enough to feel attached to the cursor.
 *
 * Damped past critical: a hover is an acknowledgement, and a mark that
 * overshoots and settles reads as the interface celebrating the pointer. */
const SNAP = { type: 'spring', stiffness: 440, damping: 31, mass: 0.55 } as const

/** Mechanisms turn with weight. A gear that snaps looks weightless. */
const TURN = { type: 'spring', stiffness: 190, damping: 22 } as const

/** Continuous, for as long as the thing is genuinely happening. */
const loop = (duration: number, delay = 0) =>
  ({ duration, delay, repeat: Infinity, ease: 'easeInOut' }) as const

/** Every (concept, drawing) pair. The single place a mark is chosen. */
const REGISTRY = {
  // -- Window and navigation ---------------------------------------------
  close: {
    p: ['M4.25 4.25 11.75 11.75', 'M11.75 4.25 4.25 11.75'],
    m: { rest: { rotate: 0 }, hover: { rotate: 90, transition: SNAP } },
  },
  /** The divider slides toward the edge -- the panel doing what the press does. */
  sidebar: {
    r: [[1.75, 2.75, 12.5, 10.5, 2.5]],
    l: [[6.25, 2.75, 6.25, 13.25]],
    parts: { l0: { v: { rest: { x: 0 }, hover: { x: -1.3, transition: SNAP } } } },
  },
  search: { c: [[7, 7, 4.25]], p: ['M10.15 10.15 13.5 13.5'] },
  /**
   * The command palette: the keychord, not a magnifier.
   *
   * Ctrl K opens commands, not files, so the affordance is the command knot --
   * four loops joined by a square -- rather than a search glass. Drawn from
   * circles and lines rather than the platform's own path, which keeps the
   * stroke weight and corner behaviour of every other mark here.
   */
  command: {
    c: [[5.1, 5.1, 1.7], [10.9, 5.1, 1.7], [5.1, 10.9, 1.7], [10.9, 10.9, 1.7]],
    l: [[6.8, 5.1, 9.2, 5.1], [10.9, 6.8, 10.9, 9.2], [6.8, 10.9, 9.2, 10.9], [5.1, 6.8, 5.1, 9.2]],
  },
  /** Restart the interface. Two arrows, because the app reloads in place. */
  reload: {
    p: [
      'M2.75 8A5.25 5.25 0 0 1 8 2.75 5.7 5.7 0 0 1 11.6 4.1',
      'M13.25 8a5.25 5.25 0 0 1-5.25 5.25 5.7 5.7 0 0 1-3.6-1.35',
    ],
    l: [[14, 1.5, 14, 6], [9.5, 6, 14, 6], [2, 10, 2, 14.5], [6.5, 14.5, 2, 14.5]],
  },

  /*
   * A gearshape, not a cog wheel. The teeth are trapezoidal with flanks that
   * slant into the body, which is what macOS draws and what a spoked circle --
   * the usual library shape -- fails to be. Generated rather than eyeballed;
   * eight teeth on radii 4.85 and 3.35.
   */
  settings: {
    p: [
      'M7.24 3.21A4.85 4.85 0 0 1 8.76 3.21L8.92 4.78A3.35 3.35 0 0 1 9.62 5.07L10.85 4.08A4.85 4.85 0 0 1 11.92 5.15L10.93 6.38A3.35 3.35 0 0 1 11.22 7.08L12.79 7.24A4.85 4.85 0 0 1 12.79 8.76L11.22 8.92A3.35 3.35 0 0 1 10.93 9.62L11.92 10.85A4.85 4.85 0 0 1 10.85 11.92L9.62 10.93A3.35 3.35 0 0 1 8.92 11.22L8.76 12.79A4.85 4.85 0 0 1 7.24 12.79L7.08 11.22A3.35 3.35 0 0 1 6.38 10.93L5.15 11.92A4.85 4.85 0 0 1 4.08 10.85L5.07 9.62A3.35 3.35 0 0 1 4.78 8.92L3.21 8.76A4.85 4.85 0 0 1 3.21 7.24L4.78 7.08A3.35 3.35 0 0 1 5.07 6.38L4.08 5.15A4.85 4.85 0 0 1 5.15 4.08L6.38 5.07A3.35 3.35 0 0 1 7.08 4.78Z',
    ],
    c: [[8, 8, 1.55]],
    /** A mechanism, so it turns rather than lights up. A quarter turn, not a
     *  half: with the tint and the colour step of hover beside it, a long
     *  rotation is what made the button read as overwhelmed. */
    m: { rest: { rotate: 0 }, hover: { rotate: 28, transition: TURN } },
  },

  newChat: {
    p: [
      'M8.5 3H4.25A1.75 1.75 0 0 0 2.5 4.75v7A1.75 1.75 0 0 0 4.25 13.5h7A1.75 1.75 0 0 0 13 11.75V7.5',
      'M11.05 2.4 13.6 4.95 8.4 10.15l-3 .45.45-3Z',
    ],
    parts: { p1: { v: { rest: { x: 0, y: 0 }, hover: { x: 0.55, y: -0.55, transition: SNAP } } } },
  },
  chat: { p: ['M13.5 7.6c0 2.7-2.46 4.85-5.5 4.85a6.6 6.6 0 0 1-1.35-.14L3.2 13.5l.75-2.6A4.6 4.6 0 0 1 2.5 7.6c0-2.68 2.46-4.85 5.5-4.85s5.5 2.17 5.5 4.85Z'] },
  more: { fc: [[3.5, 8, 1.05], [8, 8, 1.05], [12.5, 8, 1.05]] },
  /** The arrow leaves, because that is what the control does. */
  openExternal: {
    p: ['M9.5 2.75h3.75V6.5', 'M13.25 2.75 7.75 8.25', 'M12 9.4v2.85A1.75 1.75 0 0 1 10.25 14h-6.5A1.75 1.75 0 0 1 2 12.25v-6.5A1.75 1.75 0 0 1 3.75 4H6.6'],
    parts: {
      p0: { v: { rest: { x: 0, y: 0 }, hover: { x: 0.6, y: -0.6, transition: SNAP } } },
      p1: { v: { rest: { x: 0, y: 0 }, hover: { x: 0.6, y: -0.6, transition: SNAP } } },
    },
  },
  jumpToLatest: {
    p: ['M8 2.75v7.5', 'M4.75 7 8 10.25 11.25 7'],
    l: [[3.5, 13.25, 12.5, 13.25]],
    m: { rest: { y: 0 }, hover: { y: 1.2, transition: SNAP } },
  },

  // -- Disclosure --------------------------------------------------------
  expand: { p: ['M4.5 6.25 8 9.75l3.5-3.5'], m: { rest: { y: 0 }, hover: { y: 0.75, transition: SNAP } } },
  collapse: { p: ['M4.5 9.75 8 6.25l3.5 3.5'], m: { rest: { y: 0 }, hover: { y: -0.75, transition: SNAP } } },
  /**
   * One chevron that turns, rather than two glyphs that swap.
   *
   * Swapping a right-facing mark for a down-facing one is the same information
   * with a cut in the middle of it; turning is the disclosure itself.
   */
  disclosure: {
    p: ['M6.25 4.5 9.75 8l-3.5 3.5'],
    m: { rest: { rotate: 0 }, on: { rotate: 90 }, hover: { x: 0.6 } },
  },

  // -- The three that must never collide ---------------------------------
  /** A live event: the model is reasoning right now. Carried by the animated
   *  brand mark (`StudioMark` with `busy`), not a glyph -- the same mark that
   *  ripples on the splash and beside a working turn, so "Studio is working"
   *  always looks like Studio. */
  /** A setting: how much reasoning to spend. A dial, because it is a level. */
  reasoning: { p: ['M2.75 11.75a5.75 5.75 0 1 1 10.5 0', 'M8 11.25 10.9 6.6'] },
  /** A setting: what the agent may do. */
  permission: { p: ['M8 2.4 12.9 4.2v3.7c0 3-1.95 5.25-4.9 6.2-2.95-.95-4.9-3.2-4.9-6.2V4.2Z'] },

  // -- Permission modes, one mark each -----------------------------------
  /**
   * Manual: stop and ask every time.
   *
   * A pause rather than a raised hand. A hand is the better metaphor and the
   * worse drawing -- fingers at 14px collapse into a blob, and this mark has to
   * stay readable in a menu row.
   */
  permissionManual: { fr: [[5.25, 3.75, 1.9, 8.5, 0.9], [8.85, 3.75, 1.9, 8.5, 0.9]] },
  /** Accept edits: write files freely, still ask to run and reach the network. */
  permissionEdits: {
    p: ['M8.75 2.5H4.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V6.75Z', 'M8.6 2.6v4.1h4.2'],
    l: [[5.75, 10.5, 10.25, 10.5]],
  },
  /** Full auto: proceed unless a rule says ask. */
  permissionAuto: { p: ['M9.3 2.2 4.4 9.1h3.15l-.85 4.7 4.9-6.9H8.45Z'] },

  // -- Projects and source -----------------------------------------------
  project: { p: ['M2.5 5.15a1.4 1.4 0 0 1 1.4-1.4h2.25l1.45 1.75h4.5a1.4 1.4 0 0 1 1.4 1.4v5.05a1.4 1.4 0 0 1-1.4 1.4H3.9a1.4 1.4 0 0 1-1.4-1.4Z'] },
  projectOpen: {
    p: [
      'M2.5 12V5.15a1.4 1.4 0 0 1 1.4-1.4h2.25l1.45 1.75h4.5a1.4 1.4 0 0 1 1.4 1.4v.85',
      'M2.6 12.1l1.5-4.1h10.1l-1.55 4.15a1.4 1.4 0 0 1-1.3.9H3.9A1.35 1.35 0 0 1 2.6 12.1Z',
    ],
  },
  projectNew: {
    p: ['M13.5 9.5V6.9a1.4 1.4 0 0 0-1.4-1.4H7.6L6.15 3.75H3.9a1.4 1.4 0 0 0-1.4 1.4V12a1.4 1.4 0 0 0 1.4 1.4h4.35'],
    l: [[12, 10, 12, 14.25], [9.875, 12.125, 14.125, 12.125]],
  },
  branch: {
    c: [[4.5, 3.9, 1.6], [4.5, 12.1, 1.6], [11.5, 3.9, 1.6]],
    p: ['M4.5 5.5v5', 'M11.5 5.5v1.35a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 0-2.4 2.4'],
  },
  worktree: {
    r: [[5.75, 1.9, 4.5, 3.4, 1.1], [1.75, 10.7, 4.25, 3.4, 1.1], [10, 10.7, 4.25, 3.4, 1.1]],
    p: ['M8 5.3v2.35', 'M3.875 10.7V8.65h8.25v2.05', 'M3.875 8.65h8.25'],
  },

  // -- Message actions ----------------------------------------------------
  /** The top sheet lifts off the one beneath it. */
  copy: {
    r: [[5.75, 5.75, 8.25, 8.25, 1.75]],
    p: ['M10.25 5.75V3.6A1.6 1.6 0 0 0 8.65 2H3.6A1.6 1.6 0 0 0 2 3.6v5.05a1.6 1.6 0 0 0 1.6 1.6h2.15'],
    parts: { r0: { v: { rest: { x: 0, y: 0 }, hover: { x: 0.55, y: -0.55, transition: SNAP } } } },
  },
  /** Begins the rotation it is about to complete. */
  retry: {
    p: ['M13.15 8a5.15 5.15 0 1 1-1.6-3.72', 'M13.4 2.55v2.6h-2.6'],
    m: { rest: { rotate: 0 }, hover: { rotate: -45, transition: TURN }, press: { rotate: -170, transition: TURN } },
  },
  edit: {
    p: ['M10.9 2.5 13.5 5.1 5.6 13H3v-2.6Z', 'M9.6 3.8 12.2 6.4'],
    m: { rest: { x: 0, y: 0 }, hover: { x: 0.55, y: -0.55, transition: SNAP } },
  },
  /** Continue a conversation from an earlier turn, leaving the original intact. */
  fork: {
    c: [[4.5, 3.9, 1.6], [11.5, 3.9, 1.6], [8, 12.1, 1.6]],
    p: ['M4.5 5.5v1.1a2.4 2.4 0 0 0 2.4 2.4h2.2a2.4 2.4 0 0 0 2.4-2.4V5.5', 'M8 9v1.5'],
  },
  readAloud: {
    p: ['M3 6.35h1.85L7.85 3.6v8.8L4.85 9.65H3a.75.75 0 0 1-.75-.75V7.1A.75.75 0 0 1 3 6.35Z', 'M10.4 6.2a2.6 2.6 0 0 1 0 3.6', 'M12.35 4.5a5.2 5.2 0 0 1 0 7'],
  },

  // -- Composer -----------------------------------------------------------
  /**
   * The same two strokes are the plus and the close.
   *
   * Turning 45 degrees when the menu opens says "this control now undoes
   * itself" without introducing a second mark, and the user's eye keeps hold of
   * the button through the change.
   */
  add: {
    l: [[8, 3.5, 8, 12.5], [3.5, 8, 12.5, 8]],
    m: { rest: { rotate: 0 }, on: { rotate: 45, transition: SNAP } },
  },
  attach: { p: ['M11.6 7.35 7.1 11.85a2.7 2.7 0 0 1-3.8-3.8l5.4-5.4a1.8 1.8 0 0 1 2.55 2.55l-5.4 5.4a.9.9 0 0 1-1.3-1.3l4.9-4.9'] },
  /** Dictation: speech becomes text in the field. */
  dictate: {
    r: [[6.25, 1.9, 3.5, 7.2, 1.75]],
    p: ['M3.9 7.75v.6a4.1 4.1 0 0 0 8.2 0v-.6'],
    l: [[8, 12.45, 8, 14.1]],
    m: { rest: { scale: 1 }, live: { scale: [1, 1.1, 1], transition: loop(1.3) } },
  },
  /**
   * Voice mode: a spoken conversation. A different feature, so a different mark.
   *
   * The bars move on their own periods. Matched timings read as a graphic
   * playing back; mismatched ones read as something listening.
   */
  voice: {
    l: [[3, 6.75, 3, 9.25], [5.5, 4.9, 5.5, 11.1], [8, 2.9, 8, 13.1], [10.5, 5.4, 10.5, 10.6], [13, 6.75, 13, 9.25]],
    parts: {
      l0: { v: { rest: { y1: 6.75, y2: 9.25 }, live: { y1: [6.75, 5.5, 6.75], y2: [9.25, 10.5, 9.25], transition: loop(0.95) } } },
      l1: { v: { rest: { y1: 4.9, y2: 11.1 }, live: { y1: [4.9, 3.1, 4.9], y2: [11.1, 12.9, 11.1], transition: loop(0.76, 0.08) } } },
      l2: { v: { rest: { y1: 2.9, y2: 13.1 }, live: { y1: [2.9, 5.2, 2.9], y2: [13.1, 10.8, 13.1], transition: loop(1.12) } } },
      l3: { v: { rest: { y1: 5.4, y2: 10.6 }, live: { y1: [5.4, 3.5, 5.4], y2: [10.6, 12.5, 10.6], transition: loop(0.87, 0.14) } } },
      l4: { v: { rest: { y1: 6.75, y2: 9.25 }, live: { y1: [6.75, 5.9, 6.75], y2: [9.25, 10.1, 9.25], transition: loop(1.03, 0.05) } } },
    },
  },
  /** Lifts, in the direction the message goes. */
  send: {
    p: ['M8 12.75V3.4', 'M4.15 7.25 8 3.4l3.85 3.85'],
    m: { rest: { y: 0 }, hover: { y: -1.35, transition: SNAP } },
  },
  stop: { fr: [[4.75, 4.75, 6.5, 6.5, 1.6]] },
  goal: { c: [[8, 8, 5.4], [8, 8, 2.25]], fc: [[8, 8, 0.85]] },
  plan: { p: ['M2.75 4.6 4.1 5.95 6.6 3.4', 'M2.75 10.6 4.1 11.95 6.6 9.4'], l: [[8.75, 4.75, 13.25, 4.75], [8.75, 10.75, 13.25, 10.75]] },

  // -- Extensions ---------------------------------------------------------
  /** A server stack: an MCP server is a process you connect to, not a plug. */
  mcp: { r: [[2.25, 2.6, 11.5, 3.2, 1.1], [2.25, 6.4, 11.5, 3.2, 1.1], [2.25, 10.2, 11.5, 3.2, 1.1]], fc: [[4.6, 4.2, 0.62], [4.6, 8, 0.62], [4.6, 11.8, 0.62]] },
  connector: { p: ['M6.55 9.45 9.45 6.55', 'M7.1 4.7l1.35-1.35a2.75 2.75 0 0 1 3.9 3.9L11 8.6', 'M8.9 11.3l-1.35 1.35a2.75 2.75 0 0 1-3.9-3.9L5 7.4'] },
  /**
   * A module that slots in.
   *
   * A puzzle piece rather than a cube, because the project marks own the cube
   * and two isometric boxes three menu rows apart is a collision the uniqueness
   * check cannot catch -- they are different coordinates and the same picture.
   */
  skill: {
    p: [
      'M3.1 6.45a1.4 1.4 0 0 1 1.4-1.4h1.4a1.55 1.55 0 1 1 3 0h1.4a1.4 1.4 0 0 1 1.4 1.4v1.4a1.55 1.55 0 1 0 0 3v1.4a1.4 1.4 0 0 1-1.4 1.4H4.5a1.4 1.4 0 0 1-1.4-1.4Z',
    ],
  },
  hook: { p: ['M11.75 2.75v5.1a2.15 2.15 0 0 1-2.15 2.15H4.25', 'M6.75 7.4 4.15 10l2.6 2.6'] },
  browserUse: { c: [[8, 8, 5.6]], p: ['M8 2.4c1.5 1.6 2.3 3.55 2.3 5.6S9.5 12 8 13.6C6.5 12 5.7 10.05 5.7 8S6.5 4 8 2.4Z'], l: [[2.6, 8, 13.4, 8]] },

  // -- Settings sections --------------------------------------------------
  general: { c: [[8, 8, 5.6]], l: [[8, 7.4, 8, 11]], fc: [[8, 5.15, 0.75]] },
  /** A half-filled circle: the contrast setting, the way macOS draws it. */
  appearance: { c: [[8, 8, 5.6]], f: ['M8 2.4a5.6 5.6 0 0 1 0 11.2Z'] },
  /** How Studio should behave toward you -- adjustments, not identity. */
  personalization: {
    l: [[2.75, 5.5, 5.4, 5.5], [8.6, 5.5, 13.25, 5.5], [2.75, 10.5, 7.4, 10.5], [10.6, 10.5, 13.25, 10.5]],
    c: [[7, 5.5, 1.6], [9, 10.5, 1.6]],
  },
  shortcuts: {
    r: [[1.75, 3.75, 12.5, 8.5, 2]],
    l: [[4.25, 6.75, 5.25, 6.75], [7.5, 6.75, 8.5, 6.75], [10.75, 6.75, 11.75, 6.75], [5.5, 9.75, 10.5, 9.75]],
  },
  account: { c: [[8, 5.6, 2.65]], p: ['M2.9 13.6a5.35 5.35 0 0 1 10.2 0'] },
  coding: { p: ['M4.25 5.25 7 8l-2.75 2.75'], l: [[8.25, 10.75, 12, 10.75]] },
  archive: {
    r: [[2.25, 3, 11.5, 3.1, 1.1]],
    p: ['M3.35 6.1v6.15a1.35 1.35 0 0 0 1.35 1.35h6.6a1.35 1.35 0 0 0 1.35-1.35V6.1'],
    l: [[6.5, 9.1, 9.5, 9.1]],
  },

  // -- Appearance ---------------------------------------------------------
  themeSystem: { r: [[1.75, 2.9, 12.5, 8.2, 1.75]], l: [[5.5, 13.6, 10.5, 13.6], [8, 11.1, 8, 13.6]] },
  themeLight: {
    c: [[8, 8, 2.9]],
    l: [[8, 1.5, 8, 3], [8, 13, 8, 14.5], [1.5, 8, 3, 8], [13, 8, 14.5, 8], [3.4, 3.4, 4.45, 4.45], [11.55, 11.55, 12.6, 12.6], [3.4, 12.6, 4.45, 11.55], [11.55, 4.45, 12.6, 3.4]],
    m: { rest: { rotate: 0 }, hover: { rotate: 45, transition: TURN } },
  },
  themeDark: {
    p: ['M13.1 9.75A5.55 5.55 0 0 1 6.25 2.9 5.75 5.75 0 1 0 13.1 9.75Z'],
    m: { rest: { rotate: 0 }, hover: { rotate: -20, transition: TURN } },
  },

  // -- Code block and content ---------------------------------------------
  wordWrap: { p: ['M2.5 8.25h8.15a2.5 2.5 0 0 1 0 5H8.4', 'M9.9 11.4 8.1 13.2l1.8 1.8'], l: [[2.5, 3.75, 13.5, 3.75], [2.5, 12.75, 5.5, 12.75]] },
  image: {
    r: [[2, 2.9, 12, 10.2, 1.9]],
    c: [[5.7, 6.4, 1.15]],
    p: ['M2.15 11.4 6 8.05l2.7 2.4 2.2-1.85 2.95 2.6'],
  },

  // -- Confirmation and destructive ---------------------------------------
  check: { p: ['M3.5 8.4 6.4 11.3 12.5 4.9'] },
  pin: {
    p: ['M8 2.5v4.15c0 .6.3 1.15.8 1.45l1.15.7c.5.3.8.85.8 1.45v.6H5.25v-.6c0-.6.3-1.15.8-1.45l1.15-.7c.5-.3.8-.85.8-1.45V2.5'],
    l: [[6, 2.5, 10, 2.5], [8, 10.85, 8, 14]],
  },
  /** The lid hinges open before you commit -- the consequence, previewed. */
  delete: {
    p: ['M6.5 4.35V3.15a.95.95 0 0 1 .95-.95h1.1a.95.95 0 0 1 .95.95v1.2', 'M4.45 4.35 5 12.5a1.25 1.25 0 0 0 1.25 1.15h3.5A1.25 1.25 0 0 0 11 12.5l.55-8.15'],
    l: [[2.75, 4.35, 13.25, 4.35]],
    parts: {
      l0: { origin: '12% 50%', v: { rest: { rotate: 0, y: 0 }, hover: { rotate: -13, y: -0.5, transition: SNAP } } },
      p0: { origin: '50% 100%', v: { rest: { rotate: 0, y: 0 }, hover: { rotate: -13, y: -0.5, transition: SNAP } } },
    },
  },
  /** Erase what is stored, as distinct from deleting one thing. */
  clear: { p: ['M12.9 2.9 8.35 7.45', 'M6.3 6.85 9.15 9.7l-2.8 2.8a2 2 0 0 1-2.85 0 2 2 0 0 1 0-2.85Z'], l: [[7.5, 13.4, 13.5, 13.4]] },
} satisfies Record<string, Glyph>

/**
 * Fails at startup the moment two concepts are drawn from the same coordinates.
 *
 * Development only: the check costs one walk of the registry, and by production
 * this is frozen source that either passed in dev or never ran.
 */
function assertUnique(registry: Record<string, Glyph>): void {
  const seen = new Map<string, string>()
  for (const [concept, glyph] of Object.entries(registry)) {
    const signature = JSON.stringify(glyph)
    const previous = seen.get(signature)
    if (previous) {
      throw new Error(
        `Icon collision: "${concept}" is drawn identically to "${previous}". ` +
          'One mark means one concept -- draw a different glyph or merge the concepts.',
      )
    }
    seen.set(signature, concept)
  }
}

if (import.meta.env.DEV) assertUnique(REGISTRY)

type Concept = keyof typeof REGISTRY

/** Concept name to component. Consumers import from here, never a raw glyph. */
export const Icons = Object.fromEntries(
  Object.entries(REGISTRY).map(([concept, glyph]) => [concept, defineIcon(glyph, concept)]),
) as Record<Concept, ReturnType<typeof defineIcon>>

export type IconConcept = Concept
