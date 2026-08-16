import {
  DEFAULT_CODE_SIZE,
  DEFAULT_UI_SIZE,
  type CodeSize,
  type UiSize,
} from '@/design/tokens'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface Appearance {
  readonly theme: Theme
  readonly uiSize: UiSize
  readonly codeSize: CodeSize
  /** Show a pointer cursor over controls, rather than the platform arrow. */
  readonly pointerCursor: boolean
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  uiSize: DEFAULT_UI_SIZE,
  codeSize: DEFAULT_CODE_SIZE,
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
    const value = parsed as Partial<Record<keyof Appearance, unknown>>
    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
      uiSize: isUiSize(value.uiSize) ? value.uiSize : DEFAULT_APPEARANCE.uiSize,
      codeSize: isCodeSize(value.codeSize) ? value.codeSize : DEFAULT_APPEARANCE.codeSize,
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

function isUiSize(value: unknown): value is UiSize {
  return value === 12 || value === 13 || value === 14
}

function isCodeSize(value: unknown): value is CodeSize {
  return value === 11 || value === 12 || value === 13
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
  root.style.setProperty('--code-size', `${appearance.codeSize}px`)
  root.classList.toggle('pointer-cursor', appearance.pointerCursor)

  return resolved
}
