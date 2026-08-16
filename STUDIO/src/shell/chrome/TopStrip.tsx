import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { ContextMeter } from '@/shell/chrome/SessionControls'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'

/**
 * The top strip.
 *
 * Not a title bar: no fill, no hairline, no height that content must dodge. It
 * is a transparent layer over the one surface, and the page scrolls underneath
 * it behind a gradient.
 *
 * Left is the window: controls and the sidebar toggle, plus the context meter
 * once a conversation is far enough along to have one. Centre is what you are
 * looking at -- and it gets the room, because the identity line (project,
 * title, branch) is the thing worth reading here. Right is the turn settings
 * behind one mark, and only on a conversation: everywhere else the strip ends
 * in nothing, so the page's own content is the last thing at the top of the
 * window rather than a control repeated on every screen.
 */
export function TopStrip() {
  const { route, sidebarOpen, toggleSidebar } = useNavigation()
  const { conversations } = useWorkspace()

  const conversation =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null

  return (
    <header
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-30 flex items-center gap-1"
      style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
    >
      <TrafficLights />

      <div className="ml-1 flex shrink-0 items-center gap-0.5">
        <IconButton
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          tooltipSide="bottom"
          onClick={toggleSidebar}
          active={sidebarOpen}
        >
          <Icons.sidebar />
        </IconButton>

        {conversation ? <ContextMeter used={conversation.contextUsed} /> : null}
      </div>

      {/* Absolutely centred, so the identity sits on the window's midline
          rather than the midline of whatever space the two ends leave over. A
          flex-centred middle child drifts every time either end changes width,
          and both ends here change width with state. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="pointer-events-auto flex min-w-0 max-w-[60%] justify-center">
          {conversation ? <IdentityLine conversation={conversation} /> : null}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* The turn settings belong to a conversation, so that is the only
            surface they appear on. An app-wide control on every page is a
            setting you can change in places where changing it means nothing. */}
        {conversation ? <TurnMenu /> : null}
      </div>
    </header>
  )
}
