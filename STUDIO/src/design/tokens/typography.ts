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
 * ---- Why 12 ----------------------------------------------------------------
 *
 * The window is small — 1040x720, 620 at its narrowest — and 14px Inter in
 * a frame that size reads as a web page shrunk to fit rather than as something
 * drawn for the space. Inter's tall x-height makes it render larger than its
 * nominal size besides, so 12px Inter sits where 13px of a system UI face
 * sits.
 *
 * The number was not chosen in the abstract: the marks are the anchor. They
 * were drawn and tuned first, on their own grid, and they read as correct at
 * the sizes they paint. 12 is the text size at which a glyph beside a label
 * stops competing with it — smaller and the marks begin to look oversized,
 * larger and they drown. The icons decided; this file agrees with them.
 *
 * `body` sits level with `ui`. It spent a while one step under, on the theory
 * that the transcript is the one full-foreground column on screen and identical
 * pixels read as bigger there than beside muted chrome. The optics are real;
 * the lever was wrong. One step under meant the transcript rendered at 11px
 * against 12px chrome — the only text in the app anyone reads a paragraph of
 * was the smallest text in the window, and the composer you type into matched
 * it. Leading and measure answer the mass argument without costing legibility,
 * and `body` is the loosest-led role in the scale for exactly that reason.
 *
 * Level also retires a duplicate: `caption` is `ui - 1` too, so for as long as
 * `body` was, the two roles were identical in size and differed only in
 * leading. Same pixels at a different rhythm is the most reliable way to make
 * an interface read as inconsistent while every measurement says it is fine.
 *
 * ---- Stroke weight --------------------------------------------------------
 *
 * Every icon paints at about a 1.2px stroke whatever step it is drawn at, which
 * pairs with Inter 400 and 500. `non-scaling-stroke` holds it there in device
 * pixels — see `components/icons/Icon.tsx`.
 *
 * Emphasis is carried by the text going semibold; the icon beside it does not
 * change. Two things both getting heavier reads as a state change rather than
 * as emphasis.
 */

/**
 * What the appearance settings may offer.
 *
 * Both are applied as a delta on the scale above rather than as absolute sizes,
 * so a preference change moves the whole system together and the icon pairing
 * survives it. Offering absolute sizes would let someone set UI text below its
 * paired icon and break the one rule this file exists to keep.
 */
export const UI_SIZE_CHOICES = [11, 12, 13, 14] as const

/**
 * Code size, as an offset from the interface text — not an absolute px.
 *
 * This is the half that was only ever true in the comment above. The choices
 * used to be absolute (`[10, 11, 12]`), which meant the stated relationship
 * held at exactly one setting: at the 12px default, code landed on 11 and read
 * as one step under. Move the interface to 14 and code stayed at 11 — a
 * three-step gap the scale never intended — and interface 11 with code 12 was
 * reachable from the settings pane, putting a mono face *above* the sans it
 * sits beside and inverting the one relationship this pairing exists to hold.
 *
 * As an offset the relationship survives every setting, which is the same rule
 * the roles and `--control-*` already follow: state the relationship, derive
 * the number.
 */
export const CODE_OFFSET_CHOICES = [-2, -1, 0] as const

export type UiSize = (typeof UI_SIZE_CHOICES)[number]
export type CodeOffset = (typeof CODE_OFFSET_CHOICES)[number]

/**
 * The defaults of record.
 *
 * `index.css` declares matching values on `:root` as a pre-script fallback, and
 * `assertScaleDefaults` below fails loudly in development if the two ever
 * disagree — the CSS is a safety net, these are the authority.
 */
export const DEFAULT_UI_SIZE: UiSize = 12
export const DEFAULT_CODE_OFFSET: CodeOffset = -1

/** What the code text actually resolves to, for labelling a settings row. */
export function codeSizeFor(uiSize: UiSize, offset: CodeOffset): number {
  return uiSize + offset
}

/**
 * Development guard against the one duplicate the system still needs.
 *
 * CSS cannot import a TS constant, so `:root` restates the defaults for the
 * frames before `applyAppearance` runs. That is a legitimate fallback and an
 * illegitimate second source of truth at the same time — so it is checked
 * rather than trusted. Silent drift here would mean the app boots at one size
 * and the settings pane reports another, which is precisely the class of bug
 * that made the type scale untrustworthy in the first place.
 *
 * Must run *before* `applyAppearance`, and `main.tsx` is the only caller for
 * that reason: `applyAppearance` writes the stored preference to `<html>` as an
 * inline style, and from that moment the computed value is the preference
 * rather than the stylesheet's default — so a check run afterwards would
 * compare the defaults against whatever the user last chose and report a
 * mismatch on every machine that has ever touched the setting.
 */
export function assertScaleDefaults(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const root = getComputedStyle(document.documentElement)
  const declared = (name: string) => parseFloat(root.getPropertyValue(name))
  const ui = declared('--ui-size')
  const offset = declared('--code-offset')
  if (ui !== DEFAULT_UI_SIZE || offset !== DEFAULT_CODE_OFFSET) {
    console.error(
      `[design/tokens] index.css and typography.ts disagree about the defaults: ` +
        `CSS says --ui-size ${ui}px / --code-offset ${offset}px, ` +
        `TS says ${DEFAULT_UI_SIZE}px / ${DEFAULT_CODE_OFFSET}px. Make them match.`,
    )
  }
}

/**
 * Icon steps, as CSS width values.
 *
 * `text` is the default and the one to reach for: the mark is sized from the
 * text it sits in (1.1em), so the pairing above is enforced by the layout
 * rather than restated at each call site. The named steps are for marks with no
 * text beside them, and they resolve to the `--icon-*` variables in
 * `index.css`, which derive from `--ui-size` — a standalone mark tracks the
 * size preference exactly as a text-paired one does, where the old fixed px
 * steps stood still while everything around them moved.
 */
export const ICON_STEP = {
  xs: 'var(--icon-xs)',
  sm: 'var(--icon-sm)',
  /* Derived like the rest of them now. `md` is the step for a mark standing
     alone in the largest round controls — send and voice in the composer --
     and it was the one literal in the scale, pinned at 16px because those
     circles were pinned at 32. Both ends of that exemption are gone: the
     composer's controls are `--control-md` like every other icon button, so
     the mark it holds can track `--ui-size` like every other mark. */
  md: 'var(--icon-md)',
  lg: 'var(--icon-lg)',
} as const

export type IconSize = 'text' | keyof typeof ICON_STEP
