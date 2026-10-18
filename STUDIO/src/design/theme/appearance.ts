import { openStore as openStoreFile, watchStoreKey } from '@/platform/store'
import { recordClientObservation } from '@/platform/diagnostics/events'
import { isTauri } from '@/platform/tauri'
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

/**
 * Where preferences live.
 *
 * A JSON file in the OS config directory — `%APPDATA%/com.pookiepied.studio/`
 * on Windows — rather than the webview's `localStorage`.
 *
 * The distinction is not academic, and this app has already paid for it.
 * `localStorage` is browser cache: scoped to the webview's origin, wiped by
 * anything that clears site data, invisible to the person using the app, and
 * with no way to inspect or reset it short of devtools. A size chosen once
 * during an experiment sat there for weeks silently outranking every default
 * the design shipped, and no amount of changing those defaults could dislodge
 * it — because the stored value is read first, always.
 *
 * A file is the opposite of all of that: it can be opened, read, edited,
 * copied, backed up, and deleted. `Reset to defaults` in the appearance pane
 * clears it, and deleting the file by hand does the same thing.
 */
const STORE_FILE = 'preferences.json'

const openStore = () => openStoreFile(STORE_FILE)

/** Preferences are shared by all windows; receiving them never writes them back. */
export async function watchAppearance(receive: (appearance: Appearance) => void): Promise<() => void> {
  const accept = (value: unknown) => {
    recordClientObservation({ name: 'client.window', phase: 'progress', attributes: { stage: 'appearance_received' } })
    receive(coerce(value))
  }
  const off = await watchStoreKey(STORE_FILE, STORAGE_KEY, accept)
  if (off) return off
  if (isTauri()) return () => undefined
  const changed = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null)) {
      accept(readLegacy())
    }
  }
  window.addEventListener('storage', changed)
  // The appearance loaded before React mounted may already be out of date.
  accept(readLegacy())
  return () => window.removeEventListener('storage', changed)
}

/**
 * Reads the stored preferences, migrating anything still in `localStorage`.
 *
 * The migration runs once and then removes the old key, so an install that
 * predates the store keeps its choices instead of being silently reset — and
 * so the stale copy cannot come back to outrank the file later. Under
 * `pnpm dev` in a plain browser there is no Tauri and therefore no store;
 * `localStorage` remains the fallback there rather than the app losing its
 * settings every reload.
 */
export async function loadAppearance(): Promise<Appearance> {
  const store = await openStore()

  if (store) {
    const stored = await store.get(STORAGE_KEY).catch(() => undefined)
    if (stored !== undefined && stored !== null) return coerce(stored)

    // Nothing in the file yet: adopt whatever localStorage was holding, then
    // retire it. This is the one moment the two stores are both consulted.
    const legacy = readLegacy()
    if (legacy) {
      await store.set(STORAGE_KEY, legacy).catch(() => undefined)
      await store.save().catch(() => undefined)
      clearLegacy()
      return coerce(legacy)
    }
    return DEFAULT_APPEARANCE
  }

  const legacy = readLegacy()
  return legacy ? coerce(legacy) : DEFAULT_APPEARANCE
}

export async function saveAppearance(appearance: Appearance): Promise<void> {
  const store = await openStore()
  if (store) {
    await store.set(STORAGE_KEY, appearance).catch(() => undefined)
    await store.save().catch(() => undefined)
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
  } catch {
    /* storage unavailable — the preference stays session-only */
  }
}

/**
 * Forgets every stored preference, so the next read is the shipped default.
 *
 * Deletes rather than writes the defaults in. Writing them would leave a file
 * that *looks* like a choice and would keep overriding any future change to
 * the defaults — which is the exact trap this whole change exists to close.
 * An absent value means "no opinion", and no opinion is what a reset is.
 */
export async function forgetAppearance(): Promise<void> {
  const store = await openStore()
  if (store) {
    await store.delete(STORAGE_KEY).catch(() => undefined)
    await store.save().catch(() => undefined)
  }
  clearLegacy()
}

function readLegacy(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function clearLegacy(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear, or storage unavailable */
  }
}

/**
 * Field by field, because a stored blob is untrusted input: it may come from
 * an older build with a shape this one never wrote, or from a file someone
 * edited by hand — which is now a supported thing to do.
 */
function coerce(parsed: unknown): Appearance {
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_APPEARANCE
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
}

/** True when this build is a preference already differing from the shipped one. */
export function isDefaultAppearance(appearance: Appearance): boolean {
  return (
    appearance.theme === DEFAULT_APPEARANCE.theme &&
    appearance.uiSize === DEFAULT_APPEARANCE.uiSize &&
    appearance.codeOffset === DEFAULT_APPEARANCE.codeOffset &&
    appearance.pointerCursor === DEFAULT_APPEARANCE.pointerCursor
  )
}

export { DEFAULT_APPEARANCE }

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/* Derived from the choice arrays rather than restated by hand. The hand-written
   version was a second copy of the same list, and the two are the kind of pair
   that drifts: change the array, forget the guard, and every stored preference
   holding a now-unlisted value is silently discarded in favour of the default
   — the user's setting "not applying", with nothing in the code failing. */
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
 * value is turned into the offset it was actually expressing — 11 stored
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
 * because every step in the type scale is expressed in `styles/type.css` as a
 * multiple of these. One variable moves the whole system and keeps the icon
 * pairing intact; a per-element override would not.
 *
 * The resolved theme is also published to the browser itself, not only to the
 * page: `color-scheme` on the root is the standard that tells every browser
 * how to paint its own widgets and scrollbars, and the `theme-color` meta
 * hands Safari, Chrome and the Android shell a colour for the surfaces they
 * own - the address bar, the status bar. Browsers differ in how much of their
 * chrome they hand over, and both channels degrade to no-op where a browser
 * reads none of them, which is the correct direction to fail.
 */
export function applyAppearance(appearance: Appearance): ResolvedTheme {
  const resolved = resolveTheme(appearance.theme)
  const root = document.documentElement

  root.classList.toggle('dark', resolved === 'dark')
  root.style.setProperty('--ui-size', `${appearance.uiSize}px`)
  // The offset, not the size: `--code-size` is a `calc()` in styles/type.css that
  // derives from this and `--ui-size` together, so the step survives a change
  // to either one.
  root.style.setProperty('--code-offset', `${appearance.codeOffset}px`)
  root.classList.toggle('pointer-cursor', appearance.pointerCursor)

  publishBrowserTheme(resolved)

  return resolved
}

/**
 * The page's surface, as the browser chrome should wear it.
 *
 * Written as plain hex rather than read out of the palette variables: the
 * meta travels to parsers that range from full CSS color support down to
 * bare hex, and a value the browser cannot parse is simply dropped. Both
 * values mirror `--surface` in `styles/palette.css` - the one colour each
 * theme's ground is mixed from - and the paired test fails if the two drift,
 * which is what keeps the mirror honest.
 */
const SURFACE_FOR_THEME: Readonly<Record<ResolvedTheme, string>> = {
  light: '#ffffff',
  dark: '#171717',
}

/**
 * Tells the browser what this page currently looks like.
 *
 * `color-scheme` narrows the declaration `index.html` makes (both schemes
 * supported) to the one in force, so user-agent widgets stop guessing;
 * `theme-color` carries the surface to the browser chrome that shows it;
 * and in a plain browser the root's own background is painted with the
 * surface, because the chrome's bars extend the page's ground and the page
 * deliberately paints none -- see the note on the canvas below. One meta of
 * each - the element is created if a page has none and updated in place
 * afterwards, never duplicated.
 */
function publishBrowserTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.style.colorScheme = resolved

  // The canvas behind the panel. `base.css` leaves `html` transparent so the
  // desktop's window can be, but a browser tab has no window surface behind
  // the page: the lacking ground falls through to the scheme's default, and
  // WebKit's dark canvas is pure black. That is the black the phone's bars
  // wore while the page sat on 0.205 -- in light mode the two coincided, so
  // only dark ever looked wrong. Painting the root gives the bars, the
  // rubber-band overscroll and the short-page gap the same ground the panel
  // mixes, and the inline declaration outranks the layered transparent one.
  // Skipped under Tauri: there the window owns its transparency and the
  // settled design paints the surface from the panel inward.
  if (!isTauri()) root.style.backgroundColor = SURFACE_FOR_THEME[resolved]

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  const surface = SURFACE_FOR_THEME[resolved]
  if (meta.getAttribute('content') !== surface) meta.setAttribute('content', surface)
}
