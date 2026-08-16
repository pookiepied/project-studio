/**
 * The type scale, and the icon size bound to each step.
 *
 * ---- Why an icon size lives in the type scale -----------------------------
 *
 * Because pairing them by eye is what went wrong. A glyph is mostly negative
 * space; an icon is a solid mark. Set at the same nominal size the icon always
 * looks bigger, so matching the numbers produces a mismatch and matching the
 * appearance requires a number nobody can derive. Binding one to the other
 * removes the judgement call: a component picks a role, and the role already
 * knows both sizes.
 *
 * The offset is about +1px at UI sizes and +2px once text is large enough for
 * its counters to open up.
 *
 * ---- Why 13 and not 14 ----------------------------------------------------
 *
 * Inter has a tall x-height, so it renders visually larger than a system UI
 * face at the same nominal size. 13px Inter sits where 14px SF Pro sits, which
 * is the density this app was measured against.
 *
 * `body` is the one step that stays at 14: reading long prose is not the same
 * task as reading a button, and the transcript is the only place in the app
 * doing it.
 *
 * ---- Stroke weight --------------------------------------------------------
 *
 * Every icon paints at about a 1.2px stroke whatever step it is drawn at, which
 * pairs with Inter 400 and 500. Holding that constant takes a different stroke
 * width in viewBox units at each size -- see `components/icons/Icon.tsx`.
 *
 * Emphasis is carried by the text going semibold; the icon beside it does not
 * change. Two things both getting heavier reads as a state change rather than
 * as emphasis.
 */

type TypeRole = 'micro' | 'caption' | 'ui' | 'body' | 'title' | 'display'

interface TypeStep {
  /** Font size in px, before the user's size preference is applied. */
  readonly size: number
  readonly lineHeight: number
  /** The icon size that reads as equal weight beside this text. */
  readonly icon: number
}

const TYPE: Record<TypeRole, TypeStep> = {
  /** Section headers, badges, counts. Carries weight and open tracking. */
  micro: { size: 11, lineHeight: 1.45, icon: 12 },
  /** Secondary labels, menu hints, notes. Separated by colour, not size. */
  caption: { size: 12, lineHeight: 1.5, icon: 14 },
  /** The workhorse: buttons, menus, the sidebar, the composer. */
  ui: { size: 13, lineHeight: 1.55, icon: 14 },
  /** Transcript prose, and nothing else. Same size as `ui`; see index.css. */
  body: { size: 13, lineHeight: 1.68, icon: 14 },
  /** Section headings. */
  title: { size: 20, lineHeight: 1.3, icon: 22 },
  /** Page titles and greetings. Serif. */
  display: { size: 32, lineHeight: 1.15, icon: 32 },
}

/**
 * What the appearance settings may offer.
 *
 * Both are applied as a delta on the scale above rather than as absolute sizes,
 * so a preference change moves the whole system together and the icon pairing
 * survives it. Offering absolute sizes would let someone set UI text below its
 * paired icon and break the one rule this file exists to keep.
 */
export const UI_SIZE_CHOICES = [12, 13, 14] as const
export const CODE_SIZE_CHOICES = [11, 12, 13] as const

export type UiSize = (typeof UI_SIZE_CHOICES)[number]
export type CodeSize = (typeof CODE_SIZE_CHOICES)[number]

export const DEFAULT_UI_SIZE: UiSize = 13
export const DEFAULT_CODE_SIZE: CodeSize = 12

/**
 * Icon sizes, as the names components use.
 *
 * `text` is the default and the one to reach for: the mark is sized from the
 * text it sits in, so the pairing above is enforced by the layout rather than
 * restated at each call site. The named steps are for marks with no text beside
 * them, and they are px because this app sets the root font-size to the user's
 * UI size -- any rem-based sizing silently shrinks with it.
 */
export const ICON = {
  xs: TYPE.micro.icon,
  sm: TYPE.ui.icon,
  /* Deliberately literal rather than `TYPE.body.icon`. `md` is the step for a
     mark that stands alone in a large control -- send and voice inside the
     composer -- and those did not shrink when body text came down to meet `ui`.
     Binding it to a text role it no longer sits beside would have shrunk them
     by proxy. */
  md: 16,
  lg: TYPE.title.icon,
} as const

export type IconSize = 'text' | keyof typeof ICON
