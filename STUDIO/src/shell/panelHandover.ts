import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The two columns are mutually exclusive, and this is how one hands the
 * window to the other.
 *
 * ---- Why they cannot share ------------------------------------------------
 *
 * Not a stylistic call: at any width where the sidebar and the rail both
 * fit, the conversation between them is narrower than either one of them,
 * which is the failure `useCompactLayout` already exists to prevent from the
 * other direction. So opening one folds the other away. The rail is folded
 * rather than closed, so its contents survive; the sidebar simply closes,
 * because the toggle that brings it back is always in the strip.
 *
 * ---- Who yields -------------------------------------------------------------
 *
 * The one that was just asked for wins, and the one already there yields.
 * The old rule was that the sidebar always won, which was right for the
 * sidebar's own toggle and wrong for everything else: opening an artifact
 * into the rail while the sidebar was up unfolded the rail and folded it
 * again in the same commit, so the click did nothing. The gesture is the
 * request; the request is what decides.
 *
 * ---- Why it is a sequence and not a swap ------------------------------------
 *
 * Both columns used to move in the same frame - one leaving, one arriving,
 * each side of a page whose width was changing twice at once. It read as a
 * fault rather than a choice, and at widths where the breakpoint flips
 * mid-move it was one. Now the yielding column leaves first, and the
 * arriving column is held off the screen until that exit has settled. Two
 * motions in order read as one intention: "put that away, bring this out".
 *
 * The store state changes at once, as it always did; what this hook holds
 * back is only what is *shown*. `sidebarShown` and `railShown` are what the
 * columns draw from, and each column reports when it has settled, which is
 * what releases the one waiting.
 */

/** The column on its way out, while the other one waits for it. */
export type Yielding = 'sidebar' | 'rail' | null

interface Columns {
  readonly sidebar: boolean
  readonly rail: boolean
}

/**
 * Which column yields, given the state before and after a change.
 *
 * Pure, so the rule can be read and tested on its own: nothing to yield
 * unless both are asked for; the rail was just opened onto an open sidebar,
 * so the sidebar yields; otherwise the rail does - the sidebar was just
 * opened, or both arrived at once and the sidebar's toggle is the more
 * deliberate gesture.
 */
export function whoYields(before: Columns, now: Columns): Yielding {
  if (!(now.sidebar && now.rail)) return null
  if (!before.rail && before.sidebar) return 'sidebar'
  return 'rail'
}

export function usePanelHandover({
  sidebarOpen,
  railOpen,
  closeSidebar,
  collapseRail,
}: {
  /** The navigation store's word: the sidebar is asked for. */
  sidebarOpen: boolean
  /** The rail store's word: it holds something and is not folded. */
  railOpen: boolean
  closeSidebar: () => void
  collapseRail: () => void
}) {
  const [yielding, setYielding] = useState<Yielding>(null)

  // The decision is made during render, from the change itself, so the
  // arriving column is never drawn for the one frame before an effect could
  // hide it again. Comparing against the last state seen is what tells the
  // rail-just-opened case from the sidebar-just-opened one.
  const [seen, setSeen] = useState<Columns>({ sidebar: sidebarOpen, rail: railOpen })
  if (seen.sidebar !== sidebarOpen || seen.rail !== railOpen) {
    const now = { sidebar: sidebarOpen, rail: railOpen }
    setSeen(now)
    const next = whoYields(seen, now)
    if (next !== null) setYielding(next)
  }

  // The yielding column is put away in the stores. After an effect rather
  // than during render, because these are other providers' state.
  useEffect(() => {
    if (yielding === 'sidebar' && sidebarOpen) closeSidebar()
    if (yielding === 'rail' && railOpen) collapseRail()
  }, [yielding, sidebarOpen, railOpen, closeSidebar, collapseRail])

  // Each column says when it has stopped moving. The waiting one is released
  // only once the yielding one is actually gone from the stores as well: a
  // settle reported for an earlier, unrelated move must not open the gate.
  const open = useRef({ sidebar: sidebarOpen, rail: railOpen })
  open.current = { sidebar: sidebarOpen, rail: railOpen }

  const sidebarSettled = useCallback(() => {
    if (!open.current.sidebar) setYielding((current) => (current === 'sidebar' ? null : current))
  }, [])

  const railSettled = useCallback(() => {
    if (!open.current.rail) setYielding((current) => (current === 'rail' ? null : current))
  }, [])

  return {
    /** What the sidebar draws: asked for, and not waiting on the rail's exit. */
    sidebarShown: sidebarOpen && yielding !== 'rail',
    /** What the rail draws: asked for, and not waiting on the sidebar's exit. */
    railShown: railOpen && yielding !== 'sidebar',
    sidebarSettled,
    railSettled,
  }
}
