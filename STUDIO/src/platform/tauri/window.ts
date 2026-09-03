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
const DEFAULT_WINDOW_SIZE = { width: 1040, height: 720 } as const

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
 * Quits the whole application, not the window.
 *
 * The window's own close is interceptable: with close-to-tray enabled (the
 * default) it hides, and an app whose every visible close button means "see
 * you later" still owes the person one button that means "goodbye". This is
 * that button, and it is the tray Quit's verb — an exit request, which runs
 * the Rust side's graceful stop — rather than a window destroy that would
 * race it.
 */
export async function quitApp(): Promise<void> {
  if (!isTauri()) return
  await invoke('quit_app')
}

/**
 * Move the window, and only move it.
 *
 * The declarative alternative, `data-tauri-drag-region`, does two things rather
 * than one: it drags, and it toggles maximize on double-click. That second
 * behaviour is not wanted anywhere in this app and is actively harmful here,
 * because the window's rounded corner is a DWM attribute
 * (`DWMWCP_ROUND`, see `src-tauri/src/window.rs`) and Windows squares the
 * corners of any maximized window. So one stray double-click on the title bar
 * turns a frameless, round-cornered panel into a hard rectangle — and it looks
 * like the app broke, because nothing in the CSS changed and nothing says the
 * window is now maximized.
 *
 * Calling `startDragging` from a pointerdown gives the drag without the second
 * behaviour. Maximizing stays where it is discoverable and deliberate: the zoom
 * control in the traffic lights.
 */
export async function startWindowDrag(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().startDragging()
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

/**
 * The conversation this window was opened for, if it is a detached one.
 *
 * Read from the URL rather than held in a store, because it is decided before
 * any React code runs and never changes for the life of the window. A store
 * would be a second source of truth for a fact the window was born with.
 */
export function detachedConversationId(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('conversation')
}

/**
 * Which diagnostic this window is, or null for an ordinary window.
 *
 * Read from the URL like `detachedConversationId`, and for the same reason:
 * which window this is was settled before any React ran, so it is a fact
 * rather than state.
 */
export function diagnosticKind(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('diagnostic')
}

/**
 * Open the harness diagnostic in its own window.
 *
 * Falls back to a browser tab outside Tauri so the control still works under
 * `pnpm dev`, where there is no native window to create.
 */
export async function openDiagnosticWindow(): Promise<void> {
  if (!isTauri()) {
    window.open('?diagnostic=harness', '_blank', 'noopener')
    return
  }
  await invoke('open_diagnostic_window')
}

/**
 * Open one conversation in its own window.
 *
 * Falls back to a browser tab outside Tauri so the same menu item works under
 * `pnpm dev`, where there is no native window to create.
 */
export async function openConversationWindow(
  conversationId: string,
  title: string,
): Promise<void> {
  if (!isTauri()) {
    window.open(`?conversation=${encodeURIComponent(conversationId)}`, '_blank', 'noopener')
    return
  }
  await invoke('open_conversation_window', { conversationId, title })
}
