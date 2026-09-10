import { load } from '@tauri-apps/plugin-store'
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart'
import { isTauri } from '@/platform/tauri'

/**
 * How the app behaves as a desktop application, rather than how it looks.
 *
 * Two settings that both reach outside the webview, which is why they are
 * here and not beside the appearance preferences: one is read by native code
 * on every window close, and the other writes a real entry in the operating
 * system's startup list.
 */
export interface WindowPreferences {
  /**
   * Closing the main window hides it to the tray instead of ending the app.
   *
   * Read by Rust on each close, from the same file this writes -- not passed
   * across a command -- so the setting is honoured even for a close that
   * happens before the frontend has finished mounting.
   */
  readonly closeToTray: boolean
}

/**
 * The default, and it is the ON one.
 *
 * Studio holds running turns, a Harness child and a conversation someone is
 * in the middle of. Closing the window is almost never a request to throw
 * that away, and the tray's `Quit Studio` is the way out for anyone who
 * disagrees. **This must stay in step with `CLOSE_TO_TRAY_DEFAULT` in
 * `src-tauri/src/lib.rs`**, which is the copy that actually decides: this one
 * only decides what the toggle shows before anybody has touched it.
 */
export const DEFAULT_WINDOW_PREFERENCES: WindowPreferences = {
  closeToTray: true,
}

const STORAGE_KEY = 'studio.window'
const STORE_FILE = 'preferences.json'

let storePromise: Promise<Awaited<ReturnType<typeof load>> | null> | null = null

/**
 * The preferences file, opened once.
 *
 * Shared with the other-devices preference (`remote-access.ts`), which lives
 * in the same file under its own key: native code reads that file directly
 * at launch, so one file is one place for it to look.
 */
export async function openPreferencesStore() {
  if (!isTauri()) return null
  storePromise ??= load(STORE_FILE, { autoSave: false }).catch(() => null)
  return storePromise
}

const openStore = openPreferencesStore

/**
 * Reads the stored window preferences.
 *
 * There is no `localStorage` fallback and no migration, unlike the appearance
 * preferences. Nothing ever stored these anywhere else, and outside Tauri
 * neither setting means anything: there is no tray to close to and no login
 * item to register.
 */
export async function loadWindowPreferences(): Promise<WindowPreferences> {
  const store = await openStore()
  if (!store) return DEFAULT_WINDOW_PREFERENCES
  const stored = await store.get(STORAGE_KEY).catch(() => undefined)
  return coerce(stored)
}

export async function saveWindowPreferences(
  preferences: WindowPreferences,
): Promise<void> {
  const store = await openStore()
  if (!store) return
  await store.set(STORAGE_KEY, preferences).catch(() => undefined)
  await store.save().catch(() => undefined)
}

/**
 * Whether the app is registered to launch at login.
 *
 * Asks the operating system rather than reading a stored preference, which
 * is the whole point: the registry entry is the truth. A preference that
 * says `false` while the entry survives is the version of this feature that
 * lies to the person who turned it off.
 */
export async function loadLaunchAtStartup(): Promise<boolean> {
  if (!isTauri()) return false
  return isAutostartEnabled().catch(() => false)
}

/**
 * Registers or removes the login item, and reports what the OS ended up
 * believing rather than what was asked for.
 *
 * The write can fail -- a policy-managed machine, a locked registry hive --
 * and a toggle that flips anyway would be lying about a change that did not
 * happen. Reading back is cheap and it is the only honest answer.
 */
export async function setLaunchAtStartup(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return false
  try {
    if (enabled) await enableAutostart()
    else await disableAutostart()
  } catch {
    /* fall through to the read-back, which reports what actually happened */
  }
  return loadLaunchAtStartup()
}

/**
 * Field by field, because a stored blob is untrusted input: the file can be
 * hand-edited, and a non-boolean reaching a control renders a broken toggle.
 */
function coerce(stored: unknown): WindowPreferences {
  if (typeof stored !== 'object' || stored === null) {
    return DEFAULT_WINDOW_PREFERENCES
  }
  const record: Record<string, unknown> = { ...stored }
  return {
    closeToTray:
      typeof record.closeToTray === 'boolean'
        ? record.closeToTray
        : DEFAULT_WINDOW_PREFERENCES.closeToTray,
  }
}
