import type { ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WindowTrafficLights } from '@/app/shell/chrome/WindowTrafficLights'
import { TopHotZone } from '@/app/shell/chrome/TopHotZone'
import { SideRail } from '@/app/shell/chrome/SideRail'
import { FloatingDock } from '@/app/shell/dock/FloatingDock'
import { SHELL } from '@/app/shell/shellConfig'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import type { View } from '@/app/navigation/views'
import ChatPage from '@/features/chat/ChatPage'
import WorkspacePage from '@/features/workspace/WorkspacePage'
import SettingsPage from '@/features/settings/SettingsPage'

/**
 * Which component renders each view. `null` means the view is in the registry
 * but has no surface yet; the dock keeps those entries disabled, so `null` is
 * unreachable rather than a blank screen. Keying by `View` makes adding a view
 * a typecheck failure here until it is answered.
 */
const VIEW_SURFACES: Record<View, ComponentType | null> = {
  chat: ChatPage,
  workspace: WorkspacePage,
  connectors: null,
  settings: SettingsPage,
}

/**
 * Composition root for the desktop shell. Wires the chrome layers, the layout
 * rails, the dock, and the active view surface — and owns nothing else.
 */
export function AppShell() {
  const { view } = useNavigation()
  const Surface = VIEW_SURFACES[view]

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground"
      style={{ borderRadius: SHELL.frameRadius }}
    >
      <TopHotZone />
      <WindowTrafficLights />
      <FloatingDock />

      <div className="flex min-h-0 flex-1">
        <SideRail side="left" />
        <main
          className="min-w-0 flex-1 overflow-hidden"
          style={{ paddingTop: SHELL.dock.bandHeight }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              /* The shell never scrolls: each view owns its own scroll region.
                 When this container scrolled too, the whole surface — composer
                 included — could be dragged up behind the transcript. */
              className="h-full min-h-0 overflow-hidden"
            >
              {Surface && <Surface />}
            </motion.div>
          </AnimatePresence>
        </main>
        <SideRail side="right" />
      </div>
    </div>
  )
}
