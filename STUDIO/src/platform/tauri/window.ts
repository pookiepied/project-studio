import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { invoke } from '@tauri-apps/api/core'

/**
 * The single boundary between the UI and the native window.
 *
 * Nothing else in the app calls the Tauri API, and every call is a no-op in the
 * browser so the same shell runs under `pnpm dev` without Tauri.
 */

/** Matches the `width`/`height` defaults in tauri.conf.json. */
export const DEFAULT_WINDOW_SIZE = { width: 1040, height: 720 } as const

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

/**
 * Put the window back to the size it ships with.
 *
 * The counterpart to remembering the size across launches: once a window
 * restores whatever you last dragged it to, there has to be a way back, or a
 * single bad drag on a second monitor is permanent.
 */
export async function resetWindowSize(): Promise<void> {
  if (!isTauri()) return
  const current = getCurrentWindow()
  await current.unmaximize()
  await current.setSize(new LogicalSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height))
  await current.center()
}

/** Signals the Rust side that the first paint happened; shows the window. */
export async function signalAppReady(): Promise<void> {
  if (!isTauri()) return
  await invoke('app_ready')
}
