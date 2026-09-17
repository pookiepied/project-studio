import { SHELL, SPRING_PANEL } from '@/design/tokens'
import { motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { TrafficLights } from '@/shell/chrome/TrafficLights'
import { TurnMenu } from '@/shell/chrome/TurnMenu'
import { cn } from '@/lib/cn'
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
 *
 * ---- How the strip shares its width ---------------------------------------
 *
 * The header is a container, and the two ends answer to it rather than to
 * fixed widths. The centred identity box caps itself at a width that leaves
 * the ends their room (the turn pill may carry a long model name, so its
 * worst case is what the centre reserves against), and below the breakpoint
 * where that worst case no longer fits, the turn pill folds to its mark
 * alone - the menu behind it is unchanged. The breakpoint is derived, not
 * chosen: it is the width where centred title + worst-case pill + window
 * controls stop fitting with air between them, which on phones and small
 * tablets is most widths.
 *
 * ---- What the floating sidebar does to it ---------------------------------
 *
 * On a narrow window the sidebar is a drawer over the page, and the strip is
 * page furniture: its toggle would sit under the drawer's brand band and its
 * centred title would paint on top of the drawer's rows. While the drawer is
 * out, the left cluster rides the drawer's own spring to its right edge -
 * the same place the toggle occupies when the column is resident - and the
 * title stands down until the drawer leaves. Desktop, where the column takes
 * space instead of covering it, never sees either motion.
 */
export function TopStrip({
  compact = false,
  sidebarShown = false,
}: {
  /** The window is narrow: the sidebar floats over the page rather than beside it. */
  compact?: boolean
  /** The floating column is on screen (handed from the shell's handover state). */
  sidebarShown?: boolean
}) {
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

  // The drawer covers the strip's own left end, so the toggle rides with it.
  // The strip itself stands down as a click surface while the drawer is out:
  // it spans the window and would otherwise intercept presses meant for the
  // drawer's brand band - the Settings route's back control lives exactly
  // there. Its two end clusters stay live; everything between yields.
  const drawerOut = compact && sidebarShown

  return (
    <header
      data-tauri-drag-region
      className={cn(
        '@container absolute inset-x-0 top-0 z-30 flex items-center gap-1',
        drawerOut && 'pointer-events-none',
      )}
      style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
    >
      <TrafficLights />

      <motion.div
        animate={{ x: drawerOut ? SHELL.sidebar.expandedWidth : 0 }}
        transition={SPRING_PANEL}
        className={cn('ml-1 flex shrink-0 items-center gap-0.5', drawerOut && 'pointer-events-auto')}
      >
        <IconButton
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          tooltipSide="bottom"
          onClick={toggleSidebar}
          active={sidebarOpen}
        >
          <Icons.sidebar size="md" />
        </IconButton>
      </motion.div>

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
          queries to resolve against; the max-width caps it, and the two
          `justify-center`s do the centring. Remove the `w-full` and the
          shrink-to-fit comes back as zero, silently.

          ---- The cap is arithmetic, not taste ------------------------------

          `62%` alone let the box reach under the turn pill: the pill's worst
          case (a long model name, truncation at its cap) plus the window
          controls is a fixed cost the centre has to leave, and 62% of a narrow
          strip does not leave it. The cap is the smaller of the old share and
          the whole strip minus that cost; under the fold-to-mark breakpoint
          the cost collapses to the icon pill's, and the centre gets the room
          back. The drawer being out hides the line entirely - a title
          painting over the drawer's rows is overlap by another name. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="@container pointer-events-auto flex w-full min-w-0 justify-center max-w-[min(62%,calc(100%-22rem))] @max-[48rem]:max-w-[min(62%,calc(100%-12rem))]">
          {conversation !== null && !drawerOut ? (
            <IdentityLine conversation={conversation} running={turnRunning} />
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'ml-auto flex shrink-0 items-center gap-0.5',
          drawerOut && 'pointer-events-auto',
        )}
      >
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
