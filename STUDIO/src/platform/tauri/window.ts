import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'

/**
 * The single boundary between the UI and the native window.
 *
 * Nothing else in the app calls the Tauri API, and every call is a no-op in the
 * browser so the same shell runs under `pnpm dev` without Tauri.
 */

/**
 * The sizes Settings offers. These are sizes and not modes: the layout follows
 * the window's width as it does at any size a person drags it to, so a preset
 * adds nothing to keep working.
 *
 * Both are OS window sizes. Compact keeps the shadow margin on each side
 * (`--window-inset` in styles/layout.css), matches the `width`/`height` defaults
 * in tauri.conf.json and gives a 720x845 panel with a sidebar drawer. Standard
 * fills its 1280x800 OS window with the reference Studio's glass frame.
 */
const WINDOW_SIZES = {
  compact: { width: 776, height: 901 },
  standard: { width: 1280, height: 800 },
} as const

export type WindowSize = keyof typeof WINDOW_SIZES

function fittedWindowSize(size: WindowSize): LogicalSize {
  const { width, height } = WINDOW_SIZES[size]
  const { availWidth, availHeight } = window.screen
  if (size === 'standard') {
    // Preserve the wide shape when a display cannot fit the reference size.
    const scale = Math.min(1, availWidth / width, availHeight / height)
    return new LogicalSize(Math.round(width * scale), Math.round(height * scale))
  }
  return new LogicalSize(Math.min(width, availWidth), Math.min(height, availHeight))
}

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0]

/** How wide the invisible resize band is, just outside the visible panel. */
const RESIZE_BAND = 8

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
 * behaviour is not wanted anywhere in this app, because a maximized window
 * loses the panel's margin and corner. So one stray double-click on the title
 * bar turns a floating, round-cornered panel into a full-screen rectangle.
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
 * Put the window at one of the offered sizes.
 *
 * The counterpart to remembering the size across launches: once a window
 * restores whatever you last dragged it to, there has to be a way back, or a
 * single bad drag on a second monitor is permanent.
 */
export async function applyWindowSize(size: WindowSize): Promise<void> {
  if (!isTauri()) return
  const current = getCurrentWindow()
  await current.unmaximize()
  await current.setSize(fittedWindowSize(size))
  await current.center()
}

/** Which offered size the window is at; null for any other size, or maximized. */
export async function readWindowSize(): Promise<WindowSize | null> {
  if (!isTauri()) return null
  const current = getCurrentWindow()
  if (await current.isMaximized()) return null
  const [physical, scale] = await Promise.all([current.innerSize(), current.scaleFactor()])
  const { width, height } = physical.toLogical(scale)
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  for (const size of Object.keys(WINDOW_SIZES) as WindowSize[]) {
    const target = fittedWindowSize(size)
    if (near(width, target.width) && near(height, target.height)) return size
  }
  return null
}

/** Calls back whenever the window's size changes. Returns how to stop. */
export async function onWindowResized(listener: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  return getCurrentWindow().onResized(listener)
}

/** The panel inside the OS window, as the resize band needs to see it. */
export interface WindowPanel {
  width: number
  height: number
  inset: number
  radius: number
}

/**
 * Which way to resize from a point just outside the panel, if any.
 *
 * The OS only offers a resize at the window's outer edge, and that edge now
 * sits an invisible margin away from what the person can see. So the band
 * follows the panel instead, and around the corners it follows the curve: a
 * straight band would leave the visible corner with nothing to grab.
 */
export function resizeDirectionAt(x: number, y: number, panel: WindowPanel): ResizeDirection | null {
  const { width, height, inset, radius } = panel
  const left = inset
  const top = inset
  const right = width - inset
  const bottom = height - inset

  const nearLeft = x < left + radius
  const nearRight = x >= right - radius
  const nearTop = y < top + radius
  const nearBottom = y >= bottom - radius
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const distance = Math.hypot(
      x - (nearLeft ? left + radius : right - radius),
      y - (nearTop ? top + radius : bottom - radius),
    )
    if (distance < radius || distance >= radius + RESIZE_BAND) return null
    if (nearTop) return nearLeft ? 'NorthWest' : 'NorthEast'
    return nearLeft ? 'SouthWest' : 'SouthEast'
  }

  if (y >= top && y < bottom) {
    if (x < left && x >= left - RESIZE_BAND) return 'West'
    if (x >= right && x < right + RESIZE_BAND) return 'East'
  }
  if (x >= left && x < right) {
    if (y < top && y >= top - RESIZE_BAND) return 'North'
    if (y >= bottom && y < bottom + RESIZE_BAND) return 'South'
  }
  return null
}

const RESIZE_CURSOR: Record<ResizeDirection, string> = {
  North: 'ns-resize',
  South: 'ns-resize',
  East: 'ew-resize',
  West: 'ew-resize',
  NorthEast: 'nesw-resize',
  SouthWest: 'nesw-resize',
  NorthWest: 'nwse-resize',
  SouthEast: 'nwse-resize',
}

/**
 * Turns the OS window into the frame around the rounded panel.
 *
 * Windows cannot round a window to the panel's radius or shadow a transparent
 * one, so the panel is inset and draws both itself. Three things come with
 * that and live here: a maximized window has no margin and no corner, the
 * resize band has to follow the panel in, and a first launch must not open
 * taller than the screen it landed on.
 */
export async function installWindowFrame(): Promise<void> {
  if (!isTauri()) return
  const current = getCurrentWindow()
  const root = document.documentElement
  root.dataset.window = 'framed'

  const measure = (name: string) =>
    Number.parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0
  const directionAt = (event: PointerEvent) =>
    resizeDirectionAt(event.clientX, event.clientY, {
      width: window.innerWidth,
      height: window.innerHeight,
      inset: measure('--window-inset-px') / (measure('--ui-zoom') || 1),
      radius: measure('--window-radius'),
    })

  document.addEventListener('pointermove', (event) => {
    const direction = directionAt(event)
    root.style.cursor = direction === null ? '' : RESIZE_CURSOR[direction]
  })
  document.addEventListener(
    'pointerdown',
    (event) => {
      const direction = directionAt(event)
      if (direction === null) return
      event.preventDefault()
      void current.startResizeDragging(direction)
    },
    true,
  )

  const syncMaximized = async () => {
    root.dataset.window = (await current.isMaximized()) ? 'maximized' : 'framed'
  }
  await current.onResized(() => void syncMaximized())
  await syncMaximized()

  const width = Math.min(window.innerWidth, window.screen.availWidth)
  const height = Math.min(window.innerHeight, window.screen.availHeight)
  if (width < window.innerWidth || height < window.innerHeight) {
    await current.setSize(new LogicalSize(width, height))
    await current.center()
  }
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

export function browserConversationId(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('browser')
}

export async function openBrowserWindow(conversationId: string): Promise<void> {
  if (!isTauri()) {
    window.open(`?browser=${encodeURIComponent(conversationId)}`, `studio-browser-${conversationId}`)
    return
  }
  await invoke('open_browser_window', { conversationId })
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
 * Which indicator this window is, or null for an ordinary window.
 *
 * `computer` is the "Studio is using your computer" pill (ADR 0055 §7): a
 * second, frameless, transparent window that `computer_indicator_show` opens
 * at the top of the display. Read from the URL like the two above.
 */
export function indicatorKind(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('indicator')
}

/**
 * Put up the pill that says Studio is using the computer, for a conversation.
 * Nothing outside Tauri: a browser tab has no desktop to indicate on.
 */
export async function showComputerIndicator(conversationId: string, mode = 'active'): Promise<void> {
  if (!isTauri()) return
  await invoke('computer_indicator_show', { conversationId, mode })
}

/** Take the pill down. */
export async function hideComputerIndicator(): Promise<void> {
  if (!isTauri()) return
  await invoke('computer_indicator_hide')
}

/** The pill's own Stop: asks the native side to tell the conversation. */
export async function requestComputerStop(requestId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('computer_indicator_stop', { requestId })
}

export async function onComputerIndicatorChanged(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen('studio://computer-indicator/changed', handler)
}

export async function onComputerIndicatorStatus(handler: (mode: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<string>('studio://computer-indicator/status', (event) => handler(event.payload))
}

export async function reportComputerStopResult(requestId: string, failed: boolean): Promise<void> {
  if (!isTauri()) return
  await emit('studio://computer-indicator/stop-result', { requestId, failed })
}

export async function onComputerStopResult(handler: (requestId: string, failed: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<{ requestId: string; failed: boolean }>('studio://computer-indicator/stop-result', (event) => handler(event.payload.requestId, event.payload.failed))
}

/**
 * Hear the pill's Stop. The payload is the conversation id the pill was up
 * for; the listener stops that conversation's computer control and its run.
 * Returns the unlisten, or a no-op outside Tauri.
 */
export async function onComputerStopRequested(
  handler: (conversationId: string, requestId: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  return listen<{ conversationId: string; requestId: string }>('studio://computer-indicator/stop', (event) => {
    handler(event.payload.conversationId, event.payload.requestId)
  })
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

/**
 * The OS directory picker, as a verb on this boundary like the window verbs
 * above.
 *
 * Resolves to the path the person chose, or null when they cancelled. The
 * null is deliberately the only "no": outside Tauri there is no picker to
 * open and this resolves null too, but a caller that needs to tell those two
 * apart asks `isTauri()` first -- the caller that has a picker owes the
 * person a quiet nothing on cancel, because changing your mind after opening
 * a dialog is the most common outcome it has, not a failure.
 *
 * Project creation uses the picker to set its workspace folder.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null
  return open({ directory: true, multiple: false })
}
