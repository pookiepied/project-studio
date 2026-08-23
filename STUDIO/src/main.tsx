import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { applyAppearance, loadAppearance } from '@/design/theme'
import { assertScaleDefaults } from '@/design/tokens'

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

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App initialAppearance={appearance} />
  </StrictMode>,
)
