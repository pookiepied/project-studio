import type { CSSProperties } from 'react'

import { isTauri } from '@/platform/tauri'

/**
 * The window's own edge: a rounded panel with a soft shadow, or nothing.
 *
 * On the desktop the app draws its own window. Decorations are off and the
 * surface is transparent, so `studio-window` is the window's edge: the panel
 * sits inset from the OS window and draws its own corner and shadow, with no
 * border, because Windows can do neither at this radius. `installWindowFrame`
 * owns the behaviour that comes with the inset.
 *
 * In a browser the tab is the window. The page fills the viewport edge to
 * edge, and a rounded corner there is not a window edge: it is the page's
 * corner cut away to show the browser's own background through the gap,
 * with a shadow drawn inside the tab for no reason. The same
 * shell, rendered in a place that already has an edge, must not draw a
 * second one. So the frame is a fact about the host, decided once here,
 * and every root that used to draw it asks instead of assuming.
 *
 * Read at render rather than at module load so the tests can stand in the
 * webview's shoes for one case and a browser's for the next.
 */
export function windowFrame(): { className: string; style: CSSProperties } {
  if (isTauri()) {
    return {
      className: 'studio-window',
      style: {},
    }
  }
  return { className: '', style: {} }
}
