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

/** How the sidebar groups conversations: under their projects, or in one flat list. */
export type SidebarOrganize = 'project' | 'list'

/** The order conversations are listed in, inside whatever grouping is active. */
export type SidebarSort = 'priority' | 'updated' | 'manual'

interface NavigationValue {
  readonly route: Route
  readonly sidebarOpen: boolean
  readonly paletteOpen: boolean
  readonly sidebarOrganize: SidebarOrganize
  readonly sidebarSort: SidebarSort
  go: (route: Route) => void
  goHome: () => void
  openChat: (conversationId: string) => void
  openProject: (projectId: string) => void
  openSettings: (sectionId?: string) => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
  setSidebarOrganize: (organize: SidebarOrganize) => void
  setSidebarSort: (sort: SidebarSort) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

const HOME: Route = { kind: 'home' }

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(HOME)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Presentation of the sidebar rather than navigation proper, but it lives
  // here with `sidebarOpen`: the workspace store is the data, and how the
  // sidebar shows that data is chrome state, not content.
  const [sidebarOrganize, setSidebarOrganize] = useState<SidebarOrganize>('project')
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>('priority')

  const go = useCallback((next: Route) => {
    setRoute(next)
    setPaletteOpen(false)
  }, [])

  const value = useMemo<NavigationValue>(
    () => ({
      route,
      sidebarOpen,
      paletteOpen,
      sidebarOrganize,
      sidebarSort,
      go,
      goHome: () => go(HOME),
      openChat: (conversationId) => go({ kind: 'chat', conversationId }),
      openProject: (projectId) => go({ kind: 'project', projectId }),
      openSettings: (sectionId = 'general') => go({ kind: 'settings', sectionId }),
      toggleSidebar: () => setSidebarOpen((open) => !open),
      setPaletteOpen,
      setSidebarOrganize,
      setSidebarSort,
    }),
    [route, sidebarOpen, paletteOpen, sidebarOrganize, sidebarSort, go],
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('useNavigation must be used within NavigationProvider')
  return context
}
