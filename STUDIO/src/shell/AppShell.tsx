import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { SHELL, VIEW_TRANSITION } from '@/design/tokens'
import { ChatPage } from '@/features/chat'
import { HomePage } from '@/features/home'
import { CommandPalette } from '@/features/palette'
import { NewProjectDialog, ProjectPage } from '@/features/projects'
import { SettingsPage } from '@/features/settings'
import { ActionsMenu } from '@/shell/ActionsMenu'
import { TopStrip } from '@/shell/chrome/TopStrip'
import { Sidebar } from '@/shell/sidebar/Sidebar'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'

/**
 * The window.
 *
 * One rounded panel filling the transparent OS window. There is no tray and no
 * inset, so there is exactly one radius in the shell -- this one, matched by
 * the DWM corner preference in `src-tauri/src/window.rs`. Two radii is how a
 * frameless window ends up with arcs that cross.
 *
 * `overflow-hidden` is what makes the corner real: without it a scrolling
 * transcript paints square right through the rounded edge.
 */
export function AppShell() {
  const { route, paletteOpen, setPaletteOpen, toggleSidebar, openSettings, goHome } =
    useNavigation()
  const { conversations, projects } = useWorkspace()
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.metaKey || event.ctrlKey
      if (!accel) return

      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault()
          // Toggle rather than open: the shortcut that summoned it is the one
          // the hand is already on, so it should dismiss it too.
          setPaletteOpen(!paletteOpen)
          break
        case 'b':
          event.preventDefault()
          toggleSidebar()
          break
        case 'n':
          event.preventDefault()
          goHome()
          break
        case ',':
          event.preventDefault()
          openSettings()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, setPaletteOpen, toggleSidebar, openSettings, goHome])

  return (
    <div
      className="relative flex h-full w-full overflow-hidden border border-hairline bg-surface"
      style={{ borderRadius: SHELL.windowRadius }}
    >
      <Sidebar onNewProject={() => setNewProjectOpen(true)} />

      <div className="relative min-w-0 flex-1">
        <TopStrip />

        {/*
          Entrance only, and no `AnimatePresence`.

          The obvious construction here is `<AnimatePresence mode="wait">`, so
          the outgoing surface finishes leaving before the next arrives. It is
          the wrong trade twice over. It puts a full exit *and* a full enter --
          360ms -- between clicking a conversation and seeing it, which makes
          switching conversations feel slow in a way no amount of easing fixes.
          And it makes navigation depend on an animation completing: anything
          that stalls the frame loop leaves the old surface mounted and the new
          one never arrives, with no way for the user to recover.

          Keying a plain `motion.main` gives the part that was worth having.
          The old surface goes immediately, the new one rises the same 6px, and
          navigation cannot get stuck because nothing waits on anything.
        */}
        <motion.main
          key={routeKey(route)}
          initial={VIEW_TRANSITION.initial}
          animate={VIEW_TRANSITION.animate}
          transition={VIEW_TRANSITION.transition}
          className="h-full"
        >
          <Surface />
        </motion.main>
      </div>

      <CommandPalette onNewProject={() => setNewProjectOpen(true)} />
      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <ActionsMenu />
    </div>
  )

  function Surface() {
    if (route.kind === 'settings') return <SettingsPage sectionId={route.sectionId} />

    if (route.kind === 'project') {
      const project = projects.find((item) => item.id === route.projectId)
      return project ? <ProjectPage project={project} /> : <HomePage />
    }

    if (route.kind === 'chat') {
      const conversation = conversations.find((item) => item.id === route.conversationId)
      return conversation ? <ChatPage conversation={conversation} /> : <HomePage />
    }

    return <HomePage />
  }
}

/** One key per destination, so switching sections animates but typing does not. */
function routeKey(route: ReturnType<typeof useNavigation>['route']): string {
  switch (route.kind) {
    case 'chat':
      return `chat:${route.conversationId}`
    case 'project':
      return `project:${route.projectId}`
    case 'settings':
      return 'settings'
    default:
      return 'home'
  }
}
