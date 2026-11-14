import { useEffect, useState } from 'react'
import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { ConversationMenu, ConversationRename } from '@/shell/chrome/ConversationMenu'
import { CloseControl, MaximizeControl } from '@/shell/chrome/WindowControls'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { cn } from '@/lib/cn'
import { startWindowDrag } from '@/platform/tauri'
import { useNavigation } from '@/stores/navigation'
import type { Route } from '@/stores/navigation/NavigationProvider'
import { useLiveWork, useWorkspace } from '@/stores/workspace'

const NEW_CONVERSATION = 'New conversation'

/**
 * The page header, with Standard's reference window controls at its left edge.
 *
 * Standard's controls belong to the page, so they move beside a resident
 * sidebar with the rest of the header. Compact keeps its right-hand controls.
 * The centered title shares the page's bounds. The right end holds the model
 * and the current work surfaces, so the draft can remain a compact input.
 *
 * It is a transparent layer over the page, which scrolls underneath behind a
 * gradient. Dragging belongs to the empty header, never to a child of it, and
 * goes through `startWindowDrag` for the reason given in `DetachedShell`.
 *
 * On a narrow window the sidebar is a drawer over the page. While it is out the
 * title and model would paint over the drawer's rows, so both stand down and
 * the header stops taking clicks between its
 * controls. The right end stays live: its panel button closes the drawer.
 */
export function TopStrip({
  compact = false,
  standard = !compact,
  sidebarShown = false,
  onOpenOverview,
  workspaceOpen = false,
  onToggleWorkspace,
}: {
  /** The window is narrow: the sidebar floats over the page rather than beside it. */
  compact?: boolean
  /** Follows the window width rather than the space left by an open Overview. */
  standard?: boolean
  /** The floating column is on screen (handed from the shell's handover state). */
  sidebarShown?: boolean
  /** Opens the right activity summary through the shell handover. */
  onOpenOverview?: () => void
  workspaceOpen?: boolean
  onToggleWorkspace?: () => void
}) {
  const { route, sidebarOpen, toggleSidebar } = useNavigation()
  const { conversations, projects } = useWorkspace()
  const { running } = useLiveWork()
  const [renaming, setRenaming] = useState(false)

  const conversation =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null
  const conversationId = conversation?.id ?? null
  useEffect(() => setRenaming(false), [conversationId])

  const drawerOut = compact && sidebarShown
  const controlsAtLeft = standard && !drawerOut

  return (
    <header
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return
        void startWindowDrag()
      }}
      className={cn(
        '@container absolute inset-x-0 top-0 z-30 flex items-center gap-4',
        drawerOut && 'pointer-events-none',
      )}
      style={{ height: SHELL.topStrip.height, paddingInline: standard ? 12 : SHELL.topStrip.paddingInline }}
    >
      {controlsAtLeft ? (
        <div className="flex shrink-0 items-center gap-2">
          <TrafficLights />
          <IconButton label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} size="header"
            tooltipSide="bottom" onClick={toggleSidebar} active={sidebarOpen}>
            <Icons.sidebar size="header" />
          </IconButton>
        </div>
      ) : null}
      {drawerOut ? null : (
        <div className="studio-header-title flex min-w-0 items-center justify-center">
          {renaming && conversation !== null ? (
            <ConversationRename conversation={conversation} onDone={() => setRenaming(false)} />
          ) : (
            <span className={cn('min-w-0 truncate text-ui font-medium text-foreground',
              conversationId !== null && running.has(conversationId) && 'studio-shimmer')}>
              {headerTitle(route, conversation?.title ?? null, projects)}
            </span>
          )}
        </div>
      )}

      <div className={cn('ml-auto flex shrink-0 items-center', drawerOut && 'pointer-events-auto')}>
        <div className="flex items-center gap-1.5">
          {route.kind !== 'settings' && onToggleWorkspace ? <IconButton label={workspaceOpen ? 'Hide Workspace' : 'Show Workspace'} size="header"
            tooltipSide="bottom" active={workspaceOpen} onClick={onToggleWorkspace}><Icons.workArea size="header" /></IconButton> : null}
          {route.kind !== 'settings' && !drawerOut ? <TurnMenu conversationId={conversationId} /> : null}
          {controlsAtLeft ? null : <IconButton
            label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            size="header"
            tooltipSide="bottom"
            onClick={toggleSidebar}
            active={sidebarOpen}
          >
            <Icons.sidebar size="header" />
          </IconButton>}
          {standard ? null : <MaximizeControl />}
          {route.kind !== 'settings' ? <ConversationMenu
            general
            conversation={conversation}
            onRename={() => setRenaming(true)}
            onOpenOverview={onOpenOverview}
          /> : null}
          {standard ? null : <CloseControl />}
        </div>
      </div>
    </header>
  )
}

/** The page you are on, or the conversation about to start. */
function headerTitle(
  route: Route,
  conversationTitle: string | null,
  projects: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (route.kind === 'settings') return 'Settings'
  if (route.kind === 'project') return projects.find((item) => item.id === route.projectId)?.name ?? NEW_CONVERSATION
  return conversationTitle ?? NEW_CONVERSATION
}
