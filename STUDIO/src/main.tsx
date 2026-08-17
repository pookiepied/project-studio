import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { applyAppearance, readAppearance } from '@/design/theme'
import { assertScaleDefaults } from '@/design/tokens'

// Before anything writes to the root: compares the defaults `index.css`
// declares against the ones `typography.ts` owns, and complains in development
// if they have drifted apart. Must precede `applyAppearance`, which replaces
// those values with the stored preference. No-op in production.
assertScaleDefaults()

// Apply theme and text sizes before first paint, so the window never shows a
// frame at the wrong scale or in the wrong colour scheme.
applyAppearance(readAppearance())

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
