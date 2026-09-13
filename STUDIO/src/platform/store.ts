import { load } from '@tauri-apps/plugin-store'
import { isTauri } from '@/platform/tauri'

/** A preferences file the app owns, opened through the store plugin. */
export type StoreFile = Awaited<ReturnType<typeof load>>

const open = new Map<string, Promise<StoreFile | null>>()

/**
 * The one door to a stored file.
 *
 * Three modules -- the appearance, the composer drafts, the window
 * preferences -- each held their own promise to a store, and two of them
 * held one to the same file. This is the only place the plugin is named:
 * the Tauri seam is `platform/` (RULES §2), and a file that is opened in one
 * place is a file whose two readers cannot end up with two handles.
 *
 * Opened once per name, so a keystroke or a preference change does not
 * reopen the file. Outside Tauri there is no file, and every caller already
 * answers a null with its in-memory default. A failed open is a null too,
 * for the same reason: the app must not refuse to start over a preferences
 * file it cannot read.
 */
export function openStore(file: string): Promise<StoreFile | null> {
  if (!isTauri()) return Promise.resolve(null)
  let pending = open.get(file)
  if (!pending) {
    pending = load(file, { autoSave: false }).catch(() => null)
    open.set(file, pending)
  }
  return pending
}
