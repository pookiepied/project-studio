import { useContext } from 'react'

import { defineIcon, IconStateContext, type Glyph, type IconState } from '@/components/icons/Icon'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The marks that are drawn here rather than taken from the library.
 *
 * ---- Why any at all --------------------------------------------------------
 *
 * Two reasons, and only these two.
 *
 * The first is motion. Lucide ships finished components, so there is nothing
 * addressable inside a mark. That is fine for almost everything — a chevron
 * turning, send lifting, the plus becoming a cross are all transforms of a
 * whole glyph — but it cannot express a mark whose meaning lives in one part
 * that moves while the rest holds still.
 *
 * The second is fill. Lucide is a stroke set by design: every mark in it is an
 * outline, and there is no solid square, triangle or pair of bars anywhere in
 * its four thousand names. A transport control is a solid mark in every piece
 * of software that has ever had one, so the three of them are drawn here — see
 * the note above `TRANSPORT` for what an outlined stop actually looked like.
 *
 * The panel toggle is the one control where that matters. It is the most-used
 * button in the window and it carries no label, so its whole job is to say
 * which of two states the layout is in. A frame with a divider says it
 * natively: the divider is the sidebar's edge, and moving it *is* the state
 * change. The alternatives were both tried and both rejected — moving the
 * whole mark makes the button look unstable under the cursor, and darkening it
 * makes a quiet control the loudest pixel on screen.
 *
 * This is also what pays for the rule in `IconButton`. The chip carries state
 * and the glyph never darkens, so something has to replace the contrast that
 * was removed. A part that moves says more than a mark that gets blacker.
 *
 * ---- Why two overlaid SVGs rather than one animated part -------------------
 *
 * This is the part worth reading, because the obvious construction does not
 * work and fails without a word.
 *
 * The natural approach is one SVG with a `motion.line` inside it, driven by a
 * variant. `Icon.tsx` even supports it. It produced a divider that sat still in
 * every state across three separate attempts, for two stacked reasons:
 *
 *   1. `transform-box: fill-box` resolves against the shape's own bounding box,
 *      and a vertical line's box has zero width. Chromium silently drops a
 *      transform on a degenerate box.
 *   2. On an SVG motion component, framer reads `x` as the element's *attribute*
 *      of that name — `rect`, `image` and `text` all have one. `line` does not,
 *      so the value went to a meaningless attribute and no transform was ever
 *      produced.
 *
 * Both are fixed in `Icon.tsx` now, and the part still did not move. Framer was
 * verified as receiving the right state — the context reads `on`, the variant
 * is correct — and it rendered `transform: none` at every level tried: `line`,
 * a nested `svg`, and a `g`. Replacing framer with a CSS transition on the `g`
 * did not help either: the inline style updated to `translateX(0px)` while the
 * computed transform stayed where it started.
 *
 * So this stops trying to move anything inside the SVG. The frame is vector,
 * because it has a curve. The divider is an HTML element, because a div with a
 * position is the best-defined thing in the browser and nothing about it can
 * fail quietly. See the comment at the element itself.
 */




/**
 * A mark that is one static path on the 16-unit grid.
 *
 * No motion, no state — most drawn marks do not need any, and the ones that do
 * are built by hand below. It exists so a plain glyph does not have to carry
 * the sizing rule and the `studio-icon` class at each definition.
 */
function drawnMark(d: string, name: string) {
  function Mark({ size = 'text', className, style }: { size?: IconSize; className?: string; style?: React.CSSProperties }) {
    const box = size === 'text' ? '1.1em' : ICON_STEP[size]
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable={false}
        className={cn('studio-icon shrink-0', className)}
        style={{ width: box, height: box, ...style }}
      >
        <path d={d} />
      </svg>
    )
  }
  Mark.displayName = name
  return Mark
}

/**
 * Open, the divider sits where the expanded sidebar's edge is. Closed, it
 * retreats to the frame's left.
 *
 * Hover deliberately does not move it. A preview on hover made the mark
 * restless: the divider twitched every time the pointer crossed the button on
 * its way somewhere else, which is most of the times it is crossed. The
 * movement means "the panel changed", so it should happen when the panel
 * changes and at no other time — the chip already answers "you are here".
 */
const SLIDE_X: Record<IconState, number> = {
  rest: 0,
  hover: 0,
  press: 0,
  on: 3.4,
  live: 0,
}

const FRAME = 'M4.6 3.2h6.8a2.4 2.4 0 0 1 2.4 2.4v4.8a2.4 2.4 0 0 1-2.4 2.4H4.6a2.4 2.4 0 0 1-2.4-2.4V5.6a2.4 2.4 0 0 1 2.4-2.4Z'

/**
 * Voice mode.
 *
 * One continuous line that rises and falls — a voice as a waveform, drawn as a
 * single stroke rather than as a row of bars. The bars are the conventional
 * mark and they are the wrong one here: a bar chart of amplitude is a picture
 * of an audio meter, which is equipment. A line that swells once and settles is
 * a picture of someone speaking, and it sits in the same family as the rest of
 * the set, which is all single-weight strokes.
 *
 * Deliberately not a mic. The mic beside it is `dictate` — speech becoming
 * text, one turn. This is voice mode, a conversation held out loud, and the two
 * being different things is exactly why they cannot share a glyph.
 *
 * The curve is asymmetric on purpose: a perfect sine reads as a decoration or a
 * maths symbol, and the previous mark's problem was that it read as a square
 * root sign. Two unequal swells make it read as a voice.
 */
export const VoiceWave = drawnMark(
  'M1.8 8c.9 0 1.1-3.4 2.1-3.4S5 11.4 6 11.4 7.1 3.2 8.1 3.2s1.1 8.2 2.1 8.2 1.1-4.8 2-4.8 1.1 1.4 2 1.4',
  'voice',
)

/**
 * The transport: stop, play, pause. One family, drawn solid.
 *
 * ---- The bug this fixes ----------------------------------------------------
 *
 * Stop was Lucide's `Square`, and it kept being reported as sitting off-centre
 * inside its round button. It was not. Measured in the running app, the shape's
 * bounding box and the button's agreed to 0.00px on both axes at both sizes the
 * control is used at, and the flex centring had already been checked twice
 * before that. Nudging it would have moved a mark that was exactly where it
 * belonged, which is why the offset was never the answer.
 *
 * What was wrong was the mark. Lucide's `Square` is an *outline* — a 1.2px ring
 * around empty space, with `rx="2"` corners — and an outline has its weight at
 * its edges rather than in its middle. Set inside a filled disc it reads as two
 * nested containers rather than as one mark on a chip, and the eye, given no
 * mass to centre on, settles on whichever pair of edges antialiases darker.
 * That is the whole of the "not quite centred" impression, and it survives any
 * amount of arithmetic because the arithmetic was never the problem. An earlier
 * pass had already read the same symptom as a size problem and grown the voice
 * stage's glyph a step, which helped and did not fix it.
 *
 * A solid square has its weight in the middle, so there is nothing for the eye
 * to arbitrate. It is also what a stop control looks like everywhere else.
 *
 * ---- Why these are not from the library ------------------------------------
 *
 * Lucide has no filled variant of any of the three, and will not: it is a
 * stroke set with a single uniform weight, which is exactly why the rest of the
 * app uses it. Filling one of its outlines by hand would leave the corner radii
 * and proportions of a shape that was drawn to be hollow. So the transport is
 * drawn here, on the same 16-unit grid as the other marks, and it is the only
 * solid family in the app.
 *
 * ---- Why the rectangles are not SVG -----------------------------------------
 *
 * This is the part that actually settled the alignment complaint, and it is
 * worth reading before anyone moves them back into a `<path>`.
 *
 * Rounding the control steps to whole pixels (see the block on control geometry
 * in `styles/type.css`) makes the square symmetric about its own centre at every size
 * setting — at 100% display scaling. It is not enough at 125% or 150%, which is
 * what Windows 11 ships on most laptops, because the button's box is then a
 * fractional number of *device* pixels and the mark inherits the fraction.
 *
 * Underneath that is a mismatch no token can reach. The disc is a layout box
 * with a background and a border radius, and Chromium snaps a box's painted
 * rectangle to whole device pixels — which is why a 1px border is always crisp
 * and a 1px SVG line often is not. An SVG shape gets no such treatment: it is
 * rasterised at its exact subpixel position. So the circle is on the pixel grid
 * and the square inside it is wherever the arithmetic landed, and the two
 * disagree by up to half a device pixel no matter how exact the centring is.
 * Measured geometry says 0.00px and the eye says otherwise, every time.
 *
 * A square and a pair of bars are rectangles, so they can simply be layout
 * boxes and get snapped alongside the disc they sit in. The play triangle
 * stays SVG because a triangle is not a box — and it does not need this
 * anyway, since the artefact is two vertical edges that are supposed to look
 * identical and a triangle has one.
 *
 * The same reasoning, and the same conclusion, as the sidebar divider above:
 * outside the SVG none of this exists, and a span with a background is the
 * best-defined thing in the browser.
 *
 * ---- Proportions -----------------------------------------------------------
 *
 * Smaller than the outline they replace: 10 units of 16 against the 12 that
 * Lucide's square painted. Solid ink reads heavier than the same area of
 * outline, so matching them by measurement would have made the stop the
 * loudest thing in the composer. Sizes are percentages of the icon box rather
 * than pixels, so one definition covers every step: 10/16 is 62.5%, and the
 * corner radius is a fifth of the side.
 *
 */
interface TransportProps {
  size?: IconSize
  className?: string
  style?: React.CSSProperties
}

/** The box every mark is sized into. Shared with `defineIcon` and `fromLucide`. */
function markBox(size: IconSize) {
  return size === 'text' ? '1.1em' : ICON_STEP[size]
}

export function StopSquare({ size = 'text', className, style }: TransportProps) {
  const box = markBox(size)
  return (
    <span
      aria-hidden
      className={cn('studio-icon inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: box, height: box, ...style }}
    >
      <span
        className="shrink-0 bg-current"
        // 10 units of the 16-unit grid, and a radius a fifth of the side.
        style={{ width: '62.5%', height: '62.5%', borderRadius: '20%' }}
      />
    </span>
  )
}
StopSquare.displayName = 'stop'

export function PauseBars({ size = 'text', className, style }: TransportProps) {
  const box = markBox(size)
  const bar = { width: '18.75%', height: '62.5%', borderRadius: '9999px' } as const
  return (
    <span
      aria-hidden
      className={cn('studio-icon inline-flex shrink-0 items-center justify-center', className)}
      // Three units per bar and two between them, so the pair spans eight of
      // sixteen: half the box, against the square's ten. A pause reads heavier
      // than a stop at equal width because its ink is split, and the gap has to
      // stay open at 9px or the two bars merge into one blob.
      style={{ width: box, height: box, gap: '12.5%', ...style }}
    >
      <span className="shrink-0 bg-current" style={bar} />
      <span className="shrink-0 bg-current" style={bar} />
    </span>
  )
}
PauseBars.displayName = 'pause'

/**
 * The one transport mark that stays vector, because it is not a rectangle.
 *
 * It spans 5 to 13 on the grid, a whole unit right of the middle. A triangle's
 * mass sits toward its base, so a box-centred one looks as though it has slid
 * left, and the correction is optical and belongs in the glyph. It replaces a
 * `translate-x-[1px]` that used to be applied at the one call site that had
 * this mark — the same correction, made once, at the size the mark is actually
 * drawn at rather than at whatever size that call site happened to be.
 */
export const PlayTriangle = defineIcon({ f: ['M5 4 13 8 5 12Z'] } satisfies Glyph, 'play')

export function SidebarToggle({
  size = 'text',
  state,
  className,
  style,
}: {
  size?: IconSize
  state?: IconState
  className?: string
  style?: React.CSSProperties
}) {
  const inherited = useContext(IconStateContext)
  const active = state ?? inherited
  const box = size === 'text' ? '1.1em' : ICON_STEP[size]

  const svg = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  return (
    <span
      aria-hidden
      className={cn('studio-icon relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: box, height: box, ...style }}
    >
      <svg {...svg} className="absolute inset-0 size-full">
        <path d={FRAME} />
      </svg>

      {/* The divider is an HTML element, not part of the SVG.

          Worth explaining, because it looks like the odd choice and it is the
          only one that actually paints. Moving a shape *inside* an SVG was
          attempted at every level — `line`, nested `svg`, `g`, driven both by
          framer variants and by a CSS transition — and each failed differently
          and silently: framer writes a positional value to an SVG element's
          same-named attribute rather than producing a transform, `fill-box`
          collapses on a shape with no width, and a transition on a `<g>`
          transform never settles in Chromium (the inline style updated to
          `translateX(0px)` while the computed transform stayed where it began).

          Outside the SVG none of that exists. A div with a transform is the
          best-defined thing in the browser. The frame stays vector because it
          has a curve; the divider is a straight bar 1.2px wide, which is the
          same weight the stroke paints at, so the two read as one mark.

          Percentages keep it locked to the frame at any size: the mark is
          drawn on a 16-unit grid, so 35% is x=5.6 and the bar spans the frame's
          interior height exactly. */}
      <span
        aria-hidden
        className="absolute rounded-full bg-current"
        style={{
          // `left`, not a transform. A percentage transform resolves against
          // the element's own width, and this element is 1.2px wide — so the
          // whole travel would have been a quarter of a pixel. `left` resolves
          // against the containing box, which is the frame.
          left: `${((5.6 + SLIDE_X[active]) / 16) * 100}%`,
          top: '20%',
          height: '60%',
          width: 1.2,
          transition: 'left var(--duration-base) var(--ease-out-quint)',
        }}
      />
    </span>
  )
}
