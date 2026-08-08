import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Single boundary between the UI and the native window. Nothing else in the
 * app calls the Tauri window API directly, and every call is a no-op in the
 * browser so the same shell runs on the web.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().minimize()
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().toggleMaximize()
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().close()
}

/** Signals the Rust side that the first paint happened; shows the window. */
export async function signalAppReady(invoke: (cmd: string) => Promise<unknown>): Promise<void> {
  if (!isTauri()) return
  await invoke('app_ready')
}
