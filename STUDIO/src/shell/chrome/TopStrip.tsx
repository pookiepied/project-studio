import { useEffect, useState } from 'react'
import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, Switch, Tooltip } from '@/components/primitives'
import { ConversationMenu, ConversationRename } from '@/shell/chrome/ConversationMenu'
import { ConversationSelector } from '@/shell/chrome/ConversationSelector'
import { CloseControl, MaximizeControl } from '@/shell/chrome/WindowControls'
import { cn } from '@/lib/cn'
import { startWindowDrag } from '@/platform/tauri'
import { useNavigation } from '@/stores/navigation'
import type { Route } from '@/stores/navigation/NavigationProvider'
import { useLiveWork, useWorkspace } from '@/stores/workspace'

const NEW_CONVERSATION = 'New conversation'

/**
 * The header, as Family A lays it out.
 *
 * Left is where you are: the selector. Right runs Personalize, a divider, then
 * new conversation, screen capture, sidebar, maximize, more and close at one
 * pitch. Personalize and capture are drawn from the reference ahead of their
 * features, so both say they are coming rather than pretending to work.
 *
 * It is a transparent layer over the page, which scrolls underneath behind a
 * gradient. Dragging belongs to the empty header, never to a child of it, and
 * goes through `startWindowDrag` for the reason given in `DetachedShell`.
 *
 * On a narrow window the sidebar is a drawer over the page. While it is out the
 * left end would paint over the drawer's rows and Personalize would run under
 * it, so both stand down and the header stops taking clicks between its
 * controls. The right end stays live: its panel button closes the drawer.
 */
export function TopStrip({
  compact = false,
  sidebarShown = false,
  onOpenWorkspace,
}: {
  /** The window is narrow: the sidebar floats over the page rather than beside it. */
  compact?: boolean
  /** The floating column is on screen (handed from the shell's handover state). */
  sidebarShown?: boolean
  /** Present while the right workspace is folded. Opens it through the shell handover. */
  onOpenWorkspace?: () => void
}) {
  const { route, sidebarOpen, toggleSidebar, goHome } = useNavigation()
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
      style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
    >
      {drawerOut ? null : (
        <div className="flex min-w-0 items-center">
          {renaming && conversation !== null ? (
            <ConversationRename conversation={conversation} onDone={() => setRenaming(false)} />
          ) : (
            <ConversationSelector
              title={headerTitle(route, conversation?.title ?? null, projects)}
              currentId={conversationId}
              running={conversationId !== null && running.has(conversationId)}
            />
          )}
        </div>
      )}

      <div className={cn('ml-auto flex shrink-0 items-center', drawerOut && 'pointer-events-auto')}>
        {drawerOut ? null : (
          <>
            {/* The first thing to go when the header runs out of room, as it
                does at high UI scales: the title and the working controls stay. */}
            <div className="flex items-center @max-[34rem]:hidden">
              <Tooltip label="Personalization is coming soon" side="bottom" explainOnTap>
                <span className="flex items-center gap-2.5">
                  <span aria-hidden className="text-body font-medium text-foreground">Personalize</span>
                  <Switch checked disabled resting label="Personalize" />
                </span>
              </Tooltip>
              <span aria-hidden className="ml-[22px] mr-[17px] h-5 w-px bg-border" />
            </div>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <IconButton label="New conversation" size="header" tooltipSide="bottom" onClick={goHome}>
            <Icons.compose size="header" />
          </IconButton>
          <IconButton
            label="Screen capture is coming soon"
            size="header"
            tooltipSide="bottom"
            disabled
            className="disabled:opacity-100"
          >
            <Icons.capture size="header" />
          </IconButton>
          <IconButton
            label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            size="header"
            tooltipSide="bottom"
            onClick={toggleSidebar}
            active={sidebarOpen}
          >
            <Icons.sidebar size="header" />
          </IconButton>
          <MaximizeControl />
          <ConversationMenu
            general
            conversation={conversation}
            onRename={() => setRenaming(true)}
            onOpenWorkspace={onOpenWorkspace}
          />
          <CloseControl />
        </div>
      </div>
    </header>
  )
}

/** What the selector names: the page you are on, or the conversation about to start. */
function headerTitle(
  route: Route,
  conversationTitle: string | null,
  projects: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (route.kind === 'settings') return 'Settings'
  if (route.kind === 'project') return projects.find((item) => item.id === route.projectId)?.name ?? NEW_CONVERSATION
  return conversationTitle ?? NEW_CONVERSATION
}
