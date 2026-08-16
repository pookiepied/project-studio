import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ProjectTab, View } from '@/app/navigation/views'

interface NavigationContextValue {
  view: View
  /** The projects grid — the app's home surface and its resting state. */
  showProjects: () => void
  /** Open a project workspace on its chat tab. */
  openProject: (projectId: string) => void
  /** Open a project straight into one conversation. */
  openChat: (projectId: string, chatId: string) => void
  /** Switch tabs inside the open project. No-op anywhere else. */
  setProjectTab: (tab: ProjectTab) => void
  /** Switch the active conversation inside the open project. */
  setActiveChat: (chatId: string) => void
  openSettings: () => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

/**
 * Owns which surface the shell is showing. Nothing else holds this state.
 *
 * The app opens on the projects grid, not on a chat: conversations live
 * inside projects, and projects are what the sidebar and the home page list.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ name: 'projects' })

  const showProjects = useCallback(() => setView({ name: 'projects' }), [])

  const openProject = useCallback((projectId: string) => {
    setView((current) =>
      current.name === 'project' && current.projectId === projectId
        ? current
        : { name: 'project', projectId, tab: 'chat', chatId: null },
    )
  }, [])

  const openChat = useCallback((projectId: string, chatId: string) => {
    setView({ name: 'project', projectId, tab: 'chat', chatId })
  }, [])

  const setProjectTab = useCallback((tab: ProjectTab) => {
    setView((current) => (current.name === 'project' ? { ...current, tab } : current))
  }, [])

  const setActiveChat = useCallback((chatId: string) => {
    setView((current) => (current.name === 'project' ? { ...current, chatId } : current))
  }, [])

  const openSettings = useCallback(() => setView({ name: 'settings' }), [])

  return (
    <NavigationContext.Provider
      value={{ view, showProjects, openProject, openChat, setProjectTab, setActiveChat, openSettings }}
    >
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('useNavigation must be used within NavigationProvider')
  return context
}
