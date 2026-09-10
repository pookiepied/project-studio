import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { applyAppearance, DEFAULT_APPEARANCE } from '@/design/theme'
import { assertScaleDefaults } from '@/design/tokens'
import { Showcase } from './Showcase'

/**
 * The showcase's own entry: every part the app is built from, live, on one
 * page, in the real tokens and the real components.
 *
 * ---- What this is, and what it is deliberately not -------------------------
 *
 * It is a second Vite entry, reachable in development at
 * `http://localhost:1420/showcase.html`. It is not a page in the product:
 * nothing links here, the router does not know it, and `vite build` takes
 * `index.html` alone as its input, so the shipped app contains no trace of
 * it. It exists so the design can be judged part by part — hover, focus,
 * press, open, close, light, dark, at every text size — without clicking
 * through the product to arrange each state by hand.
 *
 * The mount mirrors `main.tsx` on purpose: the same `assertScaleDefaults`
 * guard, the same synchronous `applyAppearance` before first paint, so what
 * the page shows is the app's real startup contract and not a parallel one.
 * There is no store read — the page runs outside Tauri as often as inside
 * it, and a showcase that remembered its own theme would be a second
 * preference system pretending to be the first.
 */

assertScaleDefaults()
applyAppearance(DEFAULT_APPEARANCE)

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <Showcase initialAppearance={DEFAULT_APPEARANCE} />
  </StrictMode>,
)
