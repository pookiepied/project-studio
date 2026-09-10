import type { CSSProperties } from 'react'

import { SHELL } from '@/design/tokens'
import { isTauri } from '@/platform/tauri'

/**
 * The window's own edge: a rounded corner and a hairline, or nothing.
 *
 * On the desktop the app draws its own window. Decorations are off and the
 * surface is transparent, so the rounded corner and the hairline at the root
 * are the window's edge — without them the app is a sharp rectangle on the
 * desktop with no border between it and whatever is behind. That design is
 * settled and is not what this file is about.
 *
 * In a browser the tab is the window. The page fills the viewport edge to
 * edge, and a rounded corner there is not a window edge: it is the page's
 * corner cut away to show the browser's own background through the gap,
 * with a hairline drawn one pixel inside the tab for no reason. The same
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
      className: 'border border-hairline',
      style: { borderRadius: SHELL.windowRadius },
    }
  }
  return { className: '', style: {} }
}
