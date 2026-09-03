import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { applyAppearance, loadAppearance } from '@/design/theme'
import { assertScaleDefaults } from '@/design/tokens'
import { flushDrafts, primeDrafts } from '@/features/chat/composer/drafts'

// Before anything writes to the root: compares the defaults `index.css`
// declares against the ones `typography.ts` owns, and complains in development
// if they have drifted apart. Must precede `applyAppearance`, which replaces
// those values with the stored preference. No-op in production.
assertScaleDefaults()

// Apply theme and text sizes before first paint, so the window never shows a
// frame at the wrong scale or in the wrong colour scheme.
//
// Awaited at the top level, which is the whole reason the read can stay ahead
// of the paint now that preferences are a file rather than a synchronous
// `localStorage` lookup. Nothing is on screen to be delayed: the native window
// is built `visible: false` and only shows on `app_ready`, so this resolves
// inside a frame nobody sees. Rendering first and correcting afterwards was
// the alternative, and it costs a visible flash at the wrong size and theme.
const appearance = await loadAppearance()
applyAppearance(appearance)

// Unsent composer text, read before the first composer mounts so its initial
// value is the draft rather than an empty field corrected a frame later.
// Awaited alongside the appearance for the same reason: nothing is on screen
// yet, so the read costs a frame nobody sees.
await primeDrafts()

// A debounce is a bet that the process survives another moment, and a window
// going away is when that bet is worst. `pagehide` is the event that still
// fires when a webview is torn down, unlike `beforeunload`, and `hidden` also
// covers the app being sent to the background without closing.
window.addEventListener('pagehide', () => void flushDrafts())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushDrafts()
})

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App initialAppearance={appearance} />
  </StrictMode>,
)
