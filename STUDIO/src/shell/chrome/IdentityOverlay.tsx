import { SHELL, SPACE } from '@/design/tokens'
import { IdentityLine } from '@/shell/chrome/IdentityLine'
import { useCompactLayout } from '@/shell/useCompactLayout'
import { useNavigation } from '@/stores/navigation'
import { useRail } from '@/stores/rail'
import { useWorkspace } from '@/stores/workspace'

/**
 * The identity line, centred on the window.
 *
 * It used to be centred inside the top strip, and the strip lives inside the
 * page -- so the line sat on the *page's* midline, which is the window's
 * midline shifted right by half the sidebar whenever the sidebar is open, and
 * shifted again whenever the rail opens. A centred title that moves with the
 * furniture around it does not read as centred; it reads as slightly wrong, in
 * a different way on every screen. So the line is drawn here, at the shell,
 * where the window's midline is the only midline there is.
 *
 * ---- Staying clear of the columns ----------------------------------------
 *
 * Window-centred is a claim about position, not a licence to overlap. The
 * sidebar on the left and the rail on the right both own vertical strips the
 * line must not run under, so its width is capped at the largest
 * window-centred box that fits between them: half the window minus each
 * column's inset, doubled, and never more than 62% of the window regardless.
 * With both columns closed that is simply the 62% the strip always allowed;
 * with the rail open the line narrows and its own truncation takes over,
 * which is the honest response to there being less room.
 *
 * The strip's ends -- window controls, sidebar toggle, turn settings -- stay
 * where they were, in `TopStrip`. This layer holds one thing and centres it.
 */
export function IdentityOverlay() {
  const { route, sidebarOpen } = useNavigation()
  const { conversations } = useWorkspace()
  const rail = useRail()
  const compact = useCompactLayout()

  const conversation =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null

  if (!conversation) return null

  // Breathing room past each column's edge, in px. The compact sidebar floats
  // over the page rather than taking a column, so it insets nothing.
  const left = sidebarOpen && !compact ? SHELL.sidebar.expandedWidth + SPACE.lg : 0
  const right = rail.open ? rail.width + SPACE.xl : 0

  return (
    // Same construction the strip's centre used: a pointer-transparent layer
    // with one pointer-live region in the middle, so the layer can span the
    // window without covering the ends.
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
      style={{ height: SHELL.topStrip.height }}
    >
      <div
        className="@container pointer-events-auto flex min-w-0 justify-center"
        style={{ maxWidth: `calc(2 * min(50% - ${left}px, 50% - ${right}px, 31%))` }}
      >
        <IdentityLine conversation={conversation} />
      </div>
    </div>
  )
}
