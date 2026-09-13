import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { useNavigation } from '@/stores/navigation'
import { useLiveWork, useWorkspace } from '@/stores/workspace'

/**
 * The top strip.
 *
 * Not a title bar: no fill, no hairline, no height that content must dodge. It
 * is a transparent layer over the one surface, and the page scrolls underneath
 * it behind a gradient.
 *
 * Left is the window: controls and the sidebar toggle, and nothing else.
 * Centre is what you are looking at — and it gets the room, because the
 * identity line (project, title, branch) is the thing worth reading here.
 * Right is the turn: which model, how hard it thinks, and how full its window
 * is - one control, because those are one subject. Everywhere else the strip
 * ends in nothing, so the page's own content is the last thing at the top of
 * the window rather than a control repeated on every screen.
 *
 * The context meter used to be a ring of its own, first beside the sidebar
 * toggle and then beside the model pill. Neither place was right: it read as
 * a window control in the first and as a second small circle next to the
 * provider's mark in the second, and in both it was a fraction shown apart
 * from its own denominator. It lives inside the model's menu now. What is
 * left on the strip is a percentage in the pill's own words, once it is news.
 */
export function TopStrip() {
  const { route, sidebarOpen, toggleSidebar } = useNavigation()
  const { conversations } = useWorkspace()
  const { running } = useLiveWork()

  const conversation =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null

  /** Every surface that carries a composer, which is every surface but one. */
  const turnSettings = route.kind !== 'settings'

  const turnRunning = conversation !== null && running.has(conversation.id)

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
          <Icons.sidebar size="md" />
        </IconButton>
      </div>

      {/* Centred on the page, not on the window. The identity names the
          conversation, and the conversation lives in the page — so when the
          sidebar or the rail changes the column's bounds, the title moves with
          the column, exactly as the transcript under it does. A window-centred
          title would hold still while everything beneath it slid sideways,
          which reads as disconnected rather than as anchored.

          Absolutely positioned so the strip's two ends cannot push it: a
          flex-centred middle child drifts every time either end changes width,
          and both ends here change width with state.

          ---- `w-full` on the clamping box is load-bearing ------------------

          That box carries `@container`, and a container with
          `container-type: inline-size` is sized *as if it had no contents*.
          As a plain flex child that computes to zero width, and the identity
          then overflows from the centre point to the right — the title sits
          half a column right of centre no matter what the surrounding rule
          says. `w-full` gives the box a definite width for the container
          queries to resolve against; `max-w-[62%]` caps it, and the two
          `justify-center`s do the centring. Remove the `w-full` and the
          shrink-to-fit comes back as zero, silently. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="@container pointer-events-auto flex w-full min-w-0 max-w-[62%] justify-center">
          {conversation ? (
            <IdentityLine conversation={conversation} running={turnRunning} />
          ) : null}
        </div>
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
            invites the reading that it is *part of* those preferences — that
            changing it here is changing a default. It is not; it is a
            per-turn choice. Showing it where it cannot mean that is the fix. */}
        {turnSettings ? <TurnMenu /> : null}
      </div>
    </header>
  )
}
