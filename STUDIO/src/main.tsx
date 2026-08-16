import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { applyAppearance, readAppearance } from '@/design/theme'

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
