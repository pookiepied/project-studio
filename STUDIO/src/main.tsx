import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readStoredTheme, resolveTheme } from '@/app/theme/theme'

// Apply the persisted theme before first paint so the window never flashes
// the wrong color scheme.
document.documentElement.classList.toggle('dark', resolveTheme(readStoredTheme()) === 'dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
