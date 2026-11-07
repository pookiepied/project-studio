import { getCurrentWebview } from '@tauri-apps/api/webview'
import { recordClientObservation } from '@/platform/diagnostics/events'
import { isTauri } from './window'

/**
 * Scales a window's whole interface, as a browser's own zoom does.
 *
 * Done by the webview rather than the stylesheet because the webview scales
 * what the stylesheet cannot reach: every fixed pixel in every component, and
 * the viewport itself, so breakpoints, container queries and pointer maths all
 * stay true at any scale with no scaled value kept anywhere. A browser tab has
 * no such call, so it takes the CSS `zoom` property on the root.
 *
 * Three kinds of window keep 100%. The indicator and the overlay are sized by
 * the native side to fit their content exactly, and a browser window positions a
 * native page over a rectangle measured here, in CSS pixels.
 */
const UNSCALED_WINDOW = /^(?:computer-indicator|screen-overlay|browser-)/

export function setInterfaceZoom(percent: number): void {
  const factor = percent / 100
  if (!isTauri()) {
    document.documentElement.style.setProperty('zoom', factor === 1 ? '' : String(factor))
    return
  }
  // This runs before first paint, so a failure here must never stop the app. The
  // interface stays at its current scale and the preference is still stored.
  const failed = () => {
    recordClientObservation({ name: 'client.window', phase: 'progress', attributes: { stage: 'ui_scale_failed' } })
  }
  try {
    const webview = getCurrentWebview()
    if (UNSCALED_WINDOW.test(webview.label)) return
    document.documentElement.style.setProperty('--ui-zoom', String(factor))
    void webview.setZoom(factor).catch(failed)
  } catch {
    failed()
  }
}
