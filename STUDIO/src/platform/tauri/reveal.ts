import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './window'

/**
 * Reveal a filesystem location in Windows File Explorer - and do nothing
 * else. The native command opens the containing folder and selects the item
 * for a file, opens the folder itself for a directory, and never runs what
 * it is handed: an `.exe`, a shortcut, a script arrive as a selection, not
 * as a launch. Validation lives on the native side; this seam only refuses
 * to pretend the verb exists where there is no desktop, because a browser
 * client claiming Explorer opened would be a lie in both directions.
 */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) throw new Error('Revealing a folder needs the Studio desktop app.')
  await invoke('reveal_path', { path })
}
