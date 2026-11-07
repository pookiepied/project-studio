import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './window'

/**
 * Opening a file on this computer. The native side decides whether a file may
 * be opened and what starts it; this seam sends a path and an editor's name,
 * never a program. See `open_file.rs` for what is refused and why.
 */

/** An editor installed here, offered by name. */
export interface EditorChoice {
  readonly id: string
  readonly label: string
}

/** Hands a document, picture or media file to its Windows app. */
export async function openFile(path: string): Promise<void> {
  if (!isTauri()) throw new Error('Opening a file needs the Studio desktop app.')
  await invoke('open_file', { path })
}

export async function openInEditor(
  editor: string,
  path: string,
  line: number | null,
  column: number | null,
): Promise<void> {
  if (!isTauri()) throw new Error('Opening an editor needs the Studio desktop app.')
  await invoke('open_in_editor', { editor, path, line, column })
}

let editors: Promise<readonly EditorChoice[]> | null = null

/** Read once a session: installing an editor mid-session is rare and a restart finds it. */
export function installedEditors(): Promise<readonly EditorChoice[]> {
  if (!isTauri()) return Promise.resolve([])
  editors ??= invoke<readonly EditorChoice[]>('list_editors').catch(() => {
    editors = null
    return []
  })
  return editors
}
