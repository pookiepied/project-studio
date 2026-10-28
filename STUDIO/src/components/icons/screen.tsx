import { defineIcon, type Glyph } from '@/components/icons/Icon'

/**
 * The marks for working on the person's screen: sharing it, showing Studio
 * something, and the drawing toolbar's pens.
 *
 * Drawn here rather than taken from the library because the toolbar sits on
 * top of whatever is on the desktop, at one size, and every mark in it has to
 * share one hand: the same rounded joins, the same 1.2px line, the same soft
 * corners on every body. The library's pen, highlighter and eraser are three
 * different drawings by three different people, and side by side in a
 * five-button pill that was what read first.
 *
 * Each body is built from rounded rectangles and arcs, never a mitred corner.
 */

/** A pencil laid on the diagonal, its tip a short rounded wedge. */
export const PenMark = defineIcon({
  p: ['M10.6 3.1a1.55 1.55 0 0 1 2.2 2.2L6.4 11.7 3.4 12.6l.9-3z'],
  l: [[9.2, 4.5, 11.4, 6.7]],
} satisfies Glyph, 'pen')

/** A broad marker: a squared nib over a ruled line. */
export const HighlighterMark = defineIcon({
  p: ['M9.7 2.9a1.4 1.4 0 0 1 2 0l1.4 1.4a1.4 1.4 0 0 1 0 2L8.3 11.1 4.9 7.7z', 'M4.9 7.7 3.6 11.3l1.1 1.1 3.6-1.3'],
  l: [[3, 14, 13, 14]],
} satisfies Glyph, 'highlighter')

/** A rubber block on the diagonal, its worn edge resting on the line. */
export const EraserMark = defineIcon({
  p: ['M8.7 3.3a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1L7.6 12.4H5L3.3 10.7a1.5 1.5 0 0 1 0-2.1z'],
  l: [[6, 5.9, 10.1, 10], [7.6, 12.4, 12.8, 12.4]],
} satisfies Glyph, 'eraser')

/** A hook turning back: one stroke drawn backwards. */
export const UndoMark = defineIcon({
  p: ['M5.6 6.4h4.6a2.9 2.9 0 0 1 0 5.8H7.4', 'M7.6 4.3 5.4 6.4l2.2 2.2'],
} satisfies Glyph, 'undo')

/** A check, opened slightly so it reads at the toolbar's size. */
export const DoneMark = defineIcon({ p: ['M3.6 8.4 6.6 11.3 12.4 4.8'] } satisfies Glyph, 'done')

/** A display with an arrow rising out of it: this screen, going to Studio. */
export const ShareScreenMark = defineIcon({
  r: [[1.9, 2.8, 12.2, 8.6, 2]],
  l: [[6.2, 13.6, 9.8, 13.6], [8, 11.4, 8, 13.6]],
  p: ['M8 9.1V5.4', 'M6.3 7 8 5.3 9.7 7'],
} satisfies Glyph, 'share-screen')

/** A display with a loose loop drawn on it: showing Studio something. */
export const ShowMeMark = defineIcon({
  r: [[1.9, 2.8, 12.2, 8.6, 2]],
  l: [[6.2, 13.6, 9.8, 13.6], [8, 11.4, 8, 13.6]],
  p: ['M5.4 7.6c0-1.3 1.2-2.1 2.7-2.1s2.6.8 2.6 1.9-1.1 1.9-2.6 1.9c-1.2 0-2-.4-2.4-1'],
} satisfies Glyph, 'show-me')
