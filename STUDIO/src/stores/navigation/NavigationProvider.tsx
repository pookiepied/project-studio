import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Where the app is.
 *
 * A tagged union rather than a set of booleans, because the four destinations
 * are mutually exclusive and booleans let two of them be true. Settings is a
 * route and not an overlay: it is a real page with its own section tree, and
 * modelling it as a dialog is what makes a settings surface impossible to grow.
 */
type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'chat'; readonly conversationId: string }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'settings'; readonly sectionId: string }

/** How the sidebar groups conversations: under their projects, or in one flat list. */
export type SidebarOrganize = 'project' | 'list'

/** The order conversations are listed in, inside whatever grouping is active. */
export type SidebarSort = 'priority' | 'updated' | 'manual'

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
  readonly sidebarOrganize: SidebarOrganize
  readonly sidebarSort: SidebarSort
  go: (route: Route) => void
  goHome: () => void
  openChat: (conversationId: string) => void
  openProject: (projectId: string) => void
  openSettings: (sectionId?: string) => void
  leaveSettings: () => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
  setSidebarOrganize: (organize: SidebarOrganize) => void
  setSidebarSort: (sort: SidebarSort) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

const HOME: Route = { kind: 'home' }

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(HOME)
  const [move, setMove] = useState<NavigationMove>('push')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Presentation of the sidebar rather than navigation proper, but it lives
  // here with `sidebarOpen`: the workspace store is the data, and how the
  // sidebar shows that data is chrome state, not content.
  const [sidebarOrganize, setSidebarOrganize] = useState<SidebarOrganize>('project')
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>('priority')

  // ---- The Settings visit ---------------------------------------------------
  //
  // While Settings is the route, the sidebar column shows the settings tree and
  // nothing else, so the column is the only way to move between sections. A
  // column that was closed therefore has to open on entry, and a column the
  // user had deliberately closed must not stay open afterwards -- so the state
  // at entry is remembered and put back on the way out.
  //
  // `settingsReturn` is where Settings was entered from, captured once per
  // entry and never updated while moving between sections. "Back" always means
  // this one place for the whole visit; a back whose destination drifted with
  // the last section clicked would be a back nobody could trust.
  //
  // `sidebarMoved` records that the user toggled the column themselves during
  // the visit. Their last deliberate action then outranks restoration: leaving
  // Settings puts back the entry state only when the user never touched it.
  const [settingsReturn, setSettingsReturn] = useState<Route>(HOME)
  const [sidebarAtEntry, setSidebarAtEntry] = useState(false)
  const [sidebarMoved, setSidebarMoved] = useState(false)

  const go = useCallback(
    (next: Route) => {
      // Leaving Settings is any navigation out of it, not just the back
      // control -- opening a conversation from the palette is also a leaving.
      // The column was opened for Settings' sake; when that reason ends it
      // returns to what it was, unless the user moved it in the meantime.
      if (route.kind === 'settings' && next.kind !== 'settings' && !sidebarMoved) {
        setSidebarOpen(sidebarAtEntry)
      }
      setMove(moveBetween(route, next))
      setRoute(next)
      setPaletteOpen(false)
    },
    [route, sidebarMoved, sidebarAtEntry],
  )

  const openSettings = useCallback(
    (sectionId = 'general') => {
      // Entering, not switching: capture where to return to and open the
      // column, which Settings navigation requires. Switching sections inside
      // Settings changes neither -- the visit's return point was settled when
      // it began.
      if (route.kind !== 'settings') {
        setSettingsReturn(route)
        setSidebarAtEntry(sidebarOpen)
        setSidebarMoved(false)
        if (!sidebarOpen) setSidebarOpen(true)
      }
      go({ kind: 'settings', sectionId })
    },
    [route, sidebarOpen, go],
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
      sidebarOrganize,
      sidebarSort,
      go,
      goHome: () => go(HOME),
      openChat: (conversationId) => go({ kind: 'chat', conversationId }),
      openProject: (projectId) => go({ kind: 'project', projectId }),
      openSettings,
      leaveSettings,
      // Any manual move of the column -- strip toggle, Ctrl B, scrim tap --
      // cancels the pending restoration for the current Settings visit.
      toggleSidebar: () => {
        setSidebarMoved(true)
        setSidebarOpen((open) => !open)
      },
      setPaletteOpen,
      setSidebarOrganize,
      setSidebarSort,
    }),
    [route, move, sidebarOpen, paletteOpen, sidebarOrganize, sidebarSort, go, openSettings, leaveSettings],
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('useNavigation must be used within NavigationProvider')
  return context
}
