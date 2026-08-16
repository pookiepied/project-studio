import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { ContextMeter } from '@/shell/chrome/SessionControls'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { useNavigation } from '@/stores/navigation'
import { contextUsage } from '@/domain/session/context'
import { useWorkspace } from '@/stores/workspace'

/**
 * The top strip's two ends.
 *
 * Not a title bar: no fill, no hairline, no height that content must dodge. It
 * is a transparent layer over the one surface, and the page scrolls underneath
 * it behind a gradient.
 *
 * Left is the window: controls and the sidebar toggle, plus the context meter
 * once a conversation is far enough along to have one. Right is the turn
 * settings behind one mark, and only on a conversation: everywhere else the
 * strip ends in nothing, so the page's own content is the last thing at the
 * top of the window rather than a control repeated on every screen.
 *
 * The middle -- the identity line -- is not here. It is centred on the window
 * rather than on the page, and that means living at the shell rather than in
 * this strip; see `IdentityOverlay`.
 */
export function TopStrip() {
  const { route, sidebarOpen, toggleSidebar } = useNavigation()
  const { conversations, settings } = useWorkspace()

  const conversation =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null

  /** Every surface that carries a composer, which is every surface but one. */
  const turnSettings = route.kind !== 'settings'

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

        {conversation ? <ContextMeter used={contextUsage(conversation, settings.modelId)} /> : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Wherever there is a turn to configure, and nowhere else.

            These are the settings for the *next message*, so the rule is
            simply: is there a composer on this surface? On a conversation, on
            home, and in a project there is, and the control belongs there --
            including before the first message, because which model and which
            permission mode are about to be used is worth knowing before you
            type, not after.

            On Settings there is no message to send. A model picker sitting
            over a preferences page is a control with nothing to act on, and it
            invites the reading that it is *part of* those preferences -- that
            changing it here is changing a default. It is not; it is a
            per-turn choice. Showing it where it cannot mean that is the fix. */}
        {turnSettings ? <TurnMenu /> : null}
      </div>
    </header>
  )
}
