import {
  CODE_OFFSET_CHOICES,
  DEFAULT_CODE_OFFSET,
  DEFAULT_UI_SIZE,
  UI_SIZE_CHOICES,
  type CodeOffset,
  type UiSize,
} from '@/design/tokens'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface Appearance {
  readonly theme: Theme
  readonly uiSize: UiSize
  /** How far code text sits under the interface text, in px. Never absolute. */
  readonly codeOffset: CodeOffset
  /** Show a pointer cursor over controls, rather than the platform arrow. */
  readonly pointerCursor: boolean
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  uiSize: DEFAULT_UI_SIZE,
  codeOffset: DEFAULT_CODE_OFFSET,
  pointerCursor: false,
}

const STORAGE_KEY = 'studio.appearance'

export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_APPEARANCE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_APPEARANCE
    // Field by field, because a stored blob is untrusted input: it may come
    // from an older build with a shape this one never wrote.
    const value = parsed as Partial<Record<keyof Appearance, unknown>> & { codeSize?: unknown }
    const uiSize = isUiSize(value.uiSize) ? value.uiSize : DEFAULT_APPEARANCE.uiSize
    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
      uiSize,
      codeOffset: readCodeOffset(value, uiSize),
      pointerCursor:
        typeof value.pointerCursor === 'boolean'
          ? value.pointerCursor
          : DEFAULT_APPEARANCE.pointerCursor,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function writeAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
  } catch {
    /* storage unavailable -- the preference stays session-only */
  }
}

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/* Derived from the choice arrays rather than restated by hand. The hand-written
   version was a second copy of the same list, and the two are the kind of pair
   that drifts: change the array, forget the guard, and every stored preference
   holding a now-unlisted value is silently discarded in favour of the default
   -- the user's setting "not applying", with nothing in the code failing. */
const UI_SIZES: readonly unknown[] = UI_SIZE_CHOICES
const CODE_OFFSETS: readonly unknown[] = CODE_OFFSET_CHOICES

function isUiSize(value: unknown): value is UiSize {
  return UI_SIZES.includes(value)
}

function isCodeOffset(value: unknown): value is CodeOffset {
  return CODE_OFFSETS.includes(value)
}

/**
 * Reads the code preference, converting anything written by an older build.
 *
 * Code size used to be stored as an absolute px (`codeSize: 11`). Dropping that
 * key silently would reset every existing install to the default, so the old
 * value is turned into the offset it was actually expressing -- 11 stored
 * against a 12px interface *meant* "one step under", and that is what carries
 * forward. Offsets outside the offered range clamp rather than fall back, so
 * someone who had deliberately set code far below the UI keeps the closest
 * intent instead of being snapped back to default.
 */
function readCodeOffset(value: { codeOffset?: unknown; codeSize?: unknown }, uiSize: UiSize): CodeOffset {
  if (isCodeOffset(value.codeOffset)) return value.codeOffset
  if (typeof value.codeSize === 'number' && Number.isFinite(value.codeSize)) {
    const derived = value.codeSize - uiSize
    let closest: CodeOffset = DEFAULT_CODE_OFFSET
    for (const choice of CODE_OFFSET_CHOICES) {
      if (Math.abs(choice - derived) < Math.abs(closest - derived)) closest = choice
    }
    return closest
  }
  return DEFAULT_APPEARANCE.codeOffset
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/**
 * Push the appearance onto the document.
 *
 * Sizes become two CSS variables rather than a class or a set of overrides,
 * because every step in the type scale is expressed in `index.css` as a
 * multiple of these. One variable moves the whole system and keeps the icon
 * pairing intact; a per-element override would not.
 */
export function applyAppearance(appearance: Appearance): ResolvedTheme {
  const resolved = resolveTheme(appearance.theme)
  const root = document.documentElement

  root.classList.toggle('dark', resolved === 'dark')
  root.style.setProperty('--ui-size', `${appearance.uiSize}px`)
  // The offset, not the size: `--code-size` is a `calc()` in index.css that
  // derives from this and `--ui-size` together, so the step survives a change
  // to either one.
  root.style.setProperty('--code-offset', `${appearance.codeOffset}px`)
  root.classList.toggle('pointer-cursor', appearance.pointerCursor)

  return resolved
}
