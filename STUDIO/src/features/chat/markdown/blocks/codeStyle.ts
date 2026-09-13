import type { CSSProperties } from 'react'

/**
 * The geometry of a code block's body, shared by its two renderings.
 *
 * `HighlightedCode` draws the code coloured, through the highlighter that
 * arrives as its own chunk; `PlainCode` draws the same lines uncoloured while
 * that chunk is on its way. Both read these three objects, so the only thing
 * that changes when the chunk lands is the colour. A padding changed in one
 * rendering and not the other is a jump on every first block.
 */

/** The gutter, as the highlighter draws it; the plain body draws the same one. */
export const LINE_NUMBER: CSSProperties = {
  display: 'inline-block',
  minWidth: '1.75rem',
  marginRight: '0.75rem',
  textAlign: 'right',
  color: 'var(--muted-foreground)',
  opacity: 0.65,
  userSelect: 'none',
}

/**
 * No top padding: the head above already separates the code from everything
 * else, and a second gap under the rule read as the code starting late. The
 * bottom keeps its own - the last line must not sit on the frame's edge or
 * under the horizontal bar. The last value is the code's left inset; the
 * gutter sits closer to the frame's edge than the code sits to the gutter,
 * which is the ordering an editor reads by.
 */
export const BODY: CSSProperties = {
  margin: 0,
  padding: '0 1.125rem 0.875rem 0.75rem',
  fontSize: 'var(--code-size)',
  lineHeight: 1.7,
  background: 'transparent',
}

export const CODE: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 400 }

