import { useMemo } from 'react'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { useTheme } from '@/app/theme/ThemeProvider'
import { Chat, Moon, Plus, Settings, Sidebar, Sun, Apps } from '@/components/icons'
import { PROJECT_ICONS } from '@/features/projects/projectIcons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Command } from '@/features/command/commands'

/**
 * Everything the palette can reach, assembled from live app state.
 *
 * Projects and conversations come from the projects provider, so a project
 * created a second ago is findable immediately — a palette with a stale index
 * is worse than none, because you stop trusting a miss.
 *
 * `close` is passed in rather than pulled from context so the caller decides
 * the dismissal policy in one place, instead of every `run` remembering to
 * dismiss and one of them eventually forgetting.
 */
export function useCommands(close: () => void): Command[] {
  const { projects } = useProjects()
  const { openProject, openChat, showProjects, openSettings } = useNavigation()
  const { setNewProjectOpen, toggleSidebar, toggleContext } = useChrome()
  const { resolvedTheme, setTheme } = useTheme()

  return useMemo(() => {
    const then = (action: () => void) => () => {
      close()
      action()
    }

    const projectCommands: Command[] = projects.map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      detail: project.folders[0] ?? 'No folders linked',
      group: 'Projects',
      icon: PROJECT_ICONS[project.icon],
      keywords: project.branch,
      run: then(() => openProject(project.id)),
    }))

    const chatCommands: Command[] = projects.flatMap((project) =>
      project.chats.map((chat) => ({
        id: `chat:${chat.id}`,
        label: chat.title,
        // The project name is the disambiguator: two projects can both have a
        // "New conversation", and a palette that shows them as identical rows
        // is asking you to guess.
        detail: project.name,
        group: 'Conversations' as const,
        icon: Chat,
        run: then(() => openChat(project.id, chat.id)),
      })),
    )

    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
    const actionCommands: Command[] = [
      {
        id: 'action:new-project',
        label: 'New project',
        detail: 'Name it, point it at folders',
        group: 'Actions',
        icon: Plus,
        keywords: 'create add',
        run: then(() => setNewProjectOpen(true)),
      },
      {
        id: 'action:home',
        label: 'Go to Projects',
        detail: 'The home grid',
        group: 'Actions',
        icon: Apps,
        keywords: 'home overview grid',
        run: then(showProjects),
      },
      {
        id: 'action:toggle-sidebar',
        label: 'Toggle sidebar',
        detail: '⌘B',
        group: 'Actions',
        icon: Sidebar,
        keywords: 'navigator hide show panel',
        run: then(toggleSidebar),
      },
      {
        id: 'action:toggle-context',
        label: 'Toggle context panel',
        detail: '⇧⌘B',
        group: 'Actions',
        icon: Sidebar,
        keywords: 'inspector hide show panel',
        run: then(toggleContext),
      },
      {
        id: 'action:theme',
        label: `Switch to ${nextTheme} theme`,
        detail: 'Appearance',
        group: 'Actions',
        icon: nextTheme === 'dark' ? Moon : Sun,
        keywords: 'dark light appearance colour color',
        run: then(() => setTheme(nextTheme)),
      },
      {
        id: 'action:settings',
        label: 'Settings',
        detail: 'Appearance, and more to come',
        group: 'Actions',
        icon: Settings,
        keywords: 'preferences config',
        run: then(openSettings),
      },
    ]

    return [...projectCommands, ...chatCommands, ...actionCommands]
  }, [
    projects,
    close,
    openProject,
    openChat,
    showProjects,
    openSettings,
    setNewProjectOpen,
    toggleSidebar,
    toggleContext,
    resolvedTheme,
    setTheme,
  ])
}
