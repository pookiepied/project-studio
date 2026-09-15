import { useEffect, useState } from 'react'

/**
 * Whether the window is too narrow for the sidebar to take space from the page.
 *
 * ---- Why a breakpoint at all -----------------------------------------------
 *
 * The sidebar is a fixed 236px taken out of the window's width. At 1040 that is
 * a quarter of the app and reasonable. At 620 — the configured minimum — it is
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
 * re-render on every frame of it. `matchMedia` fires twice for the same drag —
 * once when the query starts matching and once when it stops — which is the
 * number of times anything here actually needs to change.
 */
/** The width below which the sidebar stops being worth its space. */
const COMPACT_WIDTH = 900

/**
 * ---- Why the rail is part of this question -------------------------------
 *
 * The rule used to read the window and nothing else, which was right while the
 * window held one panel. With the rail open it is wrong in the way that
 * matters: at 1200px the window is comfortably wide, but a 420px rail leaves
 * 780 for the sidebar *and* the conversation, which is below the threshold this
 * whole hook exists to defend. The sidebar stayed resident and the transcript
 * was squeezed into a column narrower than the sidebar beside it — the exact
 * failure the breakpoint was written to prevent, walked into from the other
 * side.
 *
 * So the query is against the space actually available. Open the rail on a
 * medium window and the sidebar becomes the floating column it already becomes
 * on a small one: summoned rather than resident, over the page rather than
 * beside it, with the scrim it already has. Nothing is hidden and nothing new
 * had to be designed — the two panels simply stop competing for the same
 * pixels.
 *
 * The width is passed in rather than read from the rail store, because what
 * counts is the rail on screen, not the rail asked for: during a handover
 * (`panelHandover`) the store says open while the column is still held off
 * the screen, and reserving for it then would flip the sidebar from resident
 * to floating in the middle of its own exit. The shell is the one caller,
 * and it passes what it is drawing.
 */
export function useCompactLayout(railWidth: number): boolean {
  // The rail's own margins count: it is inset, so it costs its width plus the
  // gap either side of it.
  const reserved = railWidth > 0 ? railWidth + 16 : 0
  const query = `(max-width: ${COMPACT_WIDTH + reserved}px)`

  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    // Re-read on mount and whenever the query itself changes: the window can be
    // resized, or the rail resized, between the state being computed and the
    // effect running, and the listener only reports changes from here on.
    setCompact(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return compact
}
