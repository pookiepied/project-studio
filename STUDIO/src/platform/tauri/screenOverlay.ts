import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DrawnShape, MonitorPlace } from '@/domain/screen/ink'
import type { MarkSet } from '@/domain/screen/marks'
import { isTauri } from './window'

/**
 * The native side of drawing on the person's screen (ADR 0059): the
 * `screen-overlay` window that `screen_overlay.rs` builds, and the events it
 * and the app pass through Rust. Every call is a no-op outside Tauri, where
 * there is no desktop to draw on.
 */

/** What the overlay is asked to draw: the agent's marks, placed on the display they name. */
export interface OverlayMarks {
  readonly monitor: MonitorPlace
  /** Null when the agent took its marks down. */
  readonly set: MarkSet | null
}

/** What the overlay should show right now, for a page that loaded after the events. */
export interface OverlayState {
  readonly drawing: { readonly monitor: MonitorPlace } | null
  readonly marks: OverlayMarks | null
}

/** Which overlay this window is, or null for an ordinary window. Read from the URL. */
export function overlayKind(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('overlay')
}

/** Show the agent's marks on screen, or take them down. */
export async function showScreenMarks(set: MarkSet | { readonly clear: true }): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_marks', { set })
}

/** "Show me": the person draws on the display their pointer is on. */
export async function startScreenDrawing(conversationId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_draw', { conversationId })
}

/** The call ended or sharing stopped: ink, marks and drawing all go. */
export async function resetScreenOverlay(): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_reset')
}

/** Hear the shapes the person drew, with the conversation they are for. */
export async function onScreenDrawn(
  handler: (conversationId: string, shapes: readonly DrawnShape[]) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<{ conversationId: string; shapes: readonly DrawnShape[] }>('studio://screen-overlay/drawn', (event) => {
    handler(event.payload.conversationId, event.payload.shapes)
  })
}

/** Hear Done in the drawing toolbar. The payload is the conversation id. */
export async function onScreenDrawingFinished(handler: (conversationId: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<string>('studio://screen-overlay/finished', (event) => {
    handler(event.payload)
  })
}

// ---- Used by the overlay window itself ----

export async function overlayState(): Promise<OverlayState | null> {
  if (!isTauri()) return null
  return invoke<OverlayState>('screen_overlay_state')
}

export async function sendDrawnShapes(shapes: readonly DrawnShape[]): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_drawn', { shapes })
}

export async function finishScreenDrawing(): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_finish')
}

/** Nothing is left on screen; the native side hides the window unless the person is drawing. */
export async function overlayIdle(): Promise<void> {
  if (!isTauri()) return
  await invoke('screen_overlay_idle')
}

export async function onOverlayMarks(handler: (marks: OverlayMarks) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<OverlayMarks>('studio://screen-overlay/marks', (event) => handler(event.payload))
}

export async function onOverlayDraw(handler: (monitor: MonitorPlace) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<{ monitor: MonitorPlace }>('studio://screen-overlay/draw', (event) => handler(event.payload.monitor))
}

export async function onOverlayReset(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen('studio://screen-overlay/reset', () => handler())
}
