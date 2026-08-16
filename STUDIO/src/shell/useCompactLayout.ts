import { useEffect, useState } from 'react'

/**
 * Whether the window is too narrow for the sidebar to take space from the page.
 *
 * ---- Why a breakpoint at all -----------------------------------------------
 *
 * The sidebar is a fixed 236px taken out of the window's width. At 1040 that is
 * a quarter of the app and reasonable. At 620 -- the configured minimum -- it is
 * well over a third, and what is left cannot hold the transcript's reading
 * measure, so the conversation is squeezed into a column narrower than the
 * sidebar beside it. The window does not break at any single width; it stops
 * being worth the trade at around 900, which is what this returns.
 *
 * Below that the column stops being part of the layout and floats over it
 * instead, so the page always keeps the whole window and the sidebar is
 * summoned rather than resident. That is also the behaviour a touch or mobile
 * viewport wants, which is why the same switch covers both rather than there
 * being a second, disagreeing rule for small screens.
 *
 * ---- Why `matchMedia` and not a resize listener ---------------------------
 *
 * A resize handler fires continuously through a drag and asks React to
 * re-render on every frame of it. `matchMedia` fires twice for the same drag --
 * once when the query starts matching and once when it stops -- which is the
 * number of times anything here actually needs to change.
 */
const COMPACT_QUERY = '(max-width: 900px)'

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    // Re-read on mount: the window can be resized between the initial state
    // being computed and the effect running, and the listener only reports
    // changes from here on.
    setCompact(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return compact
}
