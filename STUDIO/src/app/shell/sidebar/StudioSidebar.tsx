import { motion } from 'framer-motion'
import { SPRING_PANEL } from '@/app/motion'
import { useChrome } from '@/app/shell/ChromeProvider'
import { SHELL } from '@/app/shell/shellConfig'
import { SidebarProjects } from '@/app/shell/sidebar/SidebarProjects'
import { SidebarFooter } from '@/app/shell/sidebar/SidebarFooter'

/**
 * The Studio navigator — the left region of the shell.
 *
 * A rounded panel floating on the tray, at `SHELL.panelRadius` — which is
 * derived from the window's own corner so the two arcs run parallel. (An
 * earlier pass flattened this into a bordered region to fix the corner
 * mismatch; that fixed the maths by deleting the design. The radius is
 * concentric now instead.)
 *
 * Its header is gone, and that part was a genuine bug. It used to carry a
 * "Studio" wordmark and a search button at `pl-16` — 64px of padding hardcoded
 * to dodge traffic lights that only exist in Tauri, with the sidebar's own
 * toggle landing on top of the search button anyway. Both moved into the title
 * bar, where there is exactly one of each and neither has to guess at what is
 * beside it; the wordmark became the mark alone, since the title bar already
 * says where you are. What is left here is what a navigator should be: the
 * tree, and who you are.
 *
 * Nothing brand-bearing should come back to this panel. It collapses on ⌘B,
 * and a mark that disappears with it is not carrying the app's identity.
 */
export function StudioSidebar() {
  const { sidebarOpen, sidebarWidth } = useChrome()

  return (
    <motion.div
      initial={false}
      /* Closed, the rail takes no space at all — not even the tray gutter. */
      animate={{ width: sidebarOpen ? sidebarWidth : 0, marginRight: sidebarOpen ? 0 : -SHELL.panelGap }}
      transition={SPRING_PANEL}
      className="relative min-h-0 shrink-0 overflow-hidden"
      aria-hidden={!sidebarOpen}
    >
      {/*
        The inner element keeps its full width while the outer one collapses,
        so the content slides out of view instead of reflowing to nothing.
        Animating a flex layout down to 0px without this makes every row in the
        tree re-wrap on the way out, which reads as a glitch rather than a
        close.
      */}
      <motion.nav
        aria-label="Navigator"
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -16, opacity: sidebarOpen ? 1 : 0 }}
        transition={SPRING_PANEL}
        className="flex h-full flex-col overflow-hidden border border-border bg-surface"
        style={{
          width: sidebarWidth,
          minWidth: SHELL.sidebar.minWidth,
          borderRadius: SHELL.panelRadius,
        }}
      >
        <SidebarProjects />
        <SidebarFooter />
      </motion.nav>
    </motion.div>
  )
}
