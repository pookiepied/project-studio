import { AnimatePresence, motion } from 'framer-motion'
import { VIEW_TRANSITION } from '@/app/motion'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { ResizeHandle } from '@/app/shell/chrome/ResizeHandle'
import { TitleBar } from '@/app/shell/chrome/TitleBar'
import { ContextPanel } from '@/app/shell/panels/ContextPanel'
import { StudioSidebar } from '@/app/shell/sidebar/StudioSidebar'
import { SHELL } from '@/app/shell/shellConfig'
import { useShellShortcuts } from '@/app/shell/useShellShortcuts'
import { CommandPalette } from '@/features/command/CommandPalette'
import { NewProjectDialog } from '@/features/projects/NewProjectDialog'
import ProjectPage from '@/features/projects/ProjectPage'
import ProjectsPage from '@/features/projects/ProjectsPage'
import SettingsPage from '@/features/settings/SettingsPage'

/**
 * Composition root for the desktop shell.
 *
 * A rounded window, a transparent title bar across its top, and three rounded
 * panels floating on the tray below it. The rails have draggable widths and the
 * centre takes what is left — which is why resizing a rail *is* resizing the
 * centre, and why there is no third handle.
 *
 * The shell wires layers and owns nothing. Location lives in
 * `NavigationProvider`, panel state in `ChromeProvider`, shortcuts in
 * `useShellShortcuts`.
 */
export function AppShell() {
  const {
    sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    resetSidebarWidth,
    contextOpen,
    contextWidth,
    setContextWidth,
    resetContextWidth,
  } = useChrome()
  const { view } = useNavigation()

  useShellShortcuts()

  /* Keyed by location so switching surfaces — or switching projects —
     crossfades rather than snapping. Tab changes are *not* in the key: those
     animate inside `ProjectPage`, and keying on them here would tear down the
     whole surface, including the chat's scroll position, on every tab click. */
  const surfaceKey = view.name === 'project' ? `project-${view.projectId}` : view.name

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-surface-sunken font-sans text-foreground"
      style={{
        borderRadius: SHELL.windowRadius,
        paddingLeft: SHELL.framePadding,
        paddingRight: SHELL.framePadding,
        paddingBottom: SHELL.framePadding,
      }}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1" style={{ gap: SHELL.panelGap }}>
        <StudioSidebar />

        {/* Handles render only for an open rail: a drag target for a panel
            that is not there would resize something invisible. They sit in the
            gutter, so they consume no layout width of their own. */}
        {sidebarOpen && (
          <ResizeHandle
            side="left"
            label="Resize sidebar"
            width={sidebarWidth}
            defaultWidth={SHELL.sidebar.defaultWidth}
            onResize={setSidebarWidth}
            onReset={resetSidebarWidth}
          />
        )}

        <main
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden border border-border bg-surface"
          style={{ borderRadius: SHELL.panelRadius }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={surfaceKey}
              {...VIEW_TRANSITION}
              /* The shell never scrolls: each view owns its own scroll region. */
              className="h-full min-h-0 overflow-hidden"
            >
              {view.name === 'projects' && <ProjectsPage />}
              {view.name === 'project' && <ProjectPage projectId={view.projectId} />}
              {view.name === 'settings' && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </main>

        {contextOpen && (
          <ResizeHandle
            side="right"
            label="Resize context panel"
            width={contextWidth}
            defaultWidth={SHELL.contextPanel.defaultWidth}
            onResize={setContextWidth}
            onReset={resetContextWidth}
          />
        )}

        <ContextPanel />
      </div>

      <CommandPalette />
      <NewProjectDialog />
    </div>
  )
}
