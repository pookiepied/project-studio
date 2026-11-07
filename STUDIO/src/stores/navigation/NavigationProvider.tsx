import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Where the app is.
 *
 * A tagged union rather than a set of booleans, because the four destinations
 * are mutually exclusive and booleans let two of them be true. Settings is a
 * route and not an overlay: it is a real page with its own section tree, and
 * modelling it as a dialog is what makes a settings surface impossible to grow.
 */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'chat'; readonly conversationId: string }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'settings'; readonly sectionId: string }

/**
 * How one route hands over to the next, along the app's own hierarchy: home
 * sits under nothing, a project under home, a conversation under its project,
 * and Settings is the deepest layer. Deeper is a push, shallower is a pop,
 * and a lateral step between routes of the same kind is a sibling. The page
 * transition reads this (`surfaceTransition` in `design/tokens/motion.ts`);
 * the hierarchy, not the click, decides which way the surfaces travel.
 */
export type NavigationMove = 'push' | 'pop' | 'sibling'

function routeDepth(route: Route): number {
  switch (route.kind) {
    case 'home':
      return 0
    case 'project':
      return 1
    case 'chat':
      return 2
    case 'settings':
      return 3
  }
}

/** Pure so the classification can be tested without mounting the provider. */
export function moveBetween(previous: Route, next: Route): NavigationMove {
  if (previous.kind === next.kind) return 'sibling'
  return routeDepth(next) > routeDepth(previous) ? 'push' : 'pop'
}

interface NavigationValue {
  readonly route: Route
  /**
   * How the current route was reached from the one before it. Read together
   * with `route` at the moment the surface changes; both update in the same
   * commit, so the transition can never describe a handover it was not part of.
   */
  readonly move: NavigationMove
  readonly sidebarOpen: boolean
  readonly paletteOpen: boolean
  go: (route: Route, transition?: NavigationMove) => void
  goHome: () => void
  openChat: (conversationId: string) => void
  openProject: (projectId: string) => void
  openSettings: (sectionId?: string) => void
  leaveSettings: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  /**
   * Tells the store the window crossed the compact breakpoint, where the
   * sidebar floats over the page rather than taking space from it. The shell
   * is the one caller - it is where that fact is computed - and it publishes
   * it here because the column's restore-on-leave rule below is a layout
   * answer, not a navigation one.
   */
  setCompactLayout: (compact: boolean) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

const HOME: Route = { kind: 'home' }

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(HOME)
  const [move, setMove] = useState<NavigationMove>('push')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // `settingsReturn` is where Settings was entered from, captured once per
  // entry and never updated while moving between sections. "Back" always means
  // this one place for the whole visit; a back whose destination drifted with
  // the last section clicked would be a back nobody could trust.
  const [settingsReturn, setSettingsReturn] = useState<Route>(HOME)
  /**
   * Whether the window is narrow enough that the column floats. False until
   * the shell says otherwise, which is the desktop reading and the safe default.
   */
  const [compact, setCompact] = useState(false)

  const go = useCallback(
    (next: Route, transition?: NavigationMove) => {
      setMove(transition ?? moveBetween(route, next))
      setRoute(next)
      setPaletteOpen(false)
    },
    [route],
  )

  const openSettings = useCallback(
    (sectionId = 'general') => {
      // Entering, not switching: the visit's return point is settled once.
      // Settings carries its own section list, so the sidebar stays as it is,
      // except that a drawer must not stay open over the page it just opened.
      if (route.kind !== 'settings') {
        setSettingsReturn(route)
        if (compact) setSidebarOpen(false)
      }
      go({ kind: 'settings', sectionId })
    },
    [route, compact, go],
  )

  const leaveSettings = useCallback(() => {
    go(settingsReturn)
  }, [go, settingsReturn])

  const value = useMemo<NavigationValue>(
    () => ({
      route,
      move,
      sidebarOpen,
      paletteOpen,
      go,
      goHome: () => go(HOME),
      openChat: (conversationId) => go({ kind: 'chat', conversationId }),
      openProject: (projectId) => go({ kind: 'project', projectId }),
      openSettings,
      leaveSettings,
      toggleSidebar: () => setSidebarOpen((open) => !open),
      setSidebarOpen,
      setPaletteOpen,
      setCompactLayout: setCompact,
    }),
    [route, move, sidebarOpen, paletteOpen, go, openSettings, leaveSettings],
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('useNavigation must be used within NavigationProvider')
  return context
}
