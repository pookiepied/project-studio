import { PageTransition } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { paneFor } from '@/features/settings/panes/registry'
import { findSection } from '@/features/settings/sections'

/**
 * Settings: one page, one section at a time, one column.
 *
 * This file is layout and routing and nothing else. It does not know what is in
 * a section — `registry.tsx` resolves that — and it does not know what the
 * sections are, only that `sections.ts` has a list. It used to know all three,
 * which is how it reached two hundred lines and became the place every new
 * setting was pasted into.
 *
 * ---- Why the section lives in the route ----------------------------------
 *
 * The selected section is `route.sectionId`, not local state. Three things fall
 * out of that for free: the command palette can open a specific section and it
 * simply works, the back/forward stack steps through sections the way it steps
 * through conversations, and leaving Settings and returning lands where you
 * were rather than at the top. Local state would have needed a mechanism for
 * each of those.
 *
 * ---- Why there is no rail here -------------------------------------------
 *
 * The page used to carry a sticky section rail beside the pane, and the rail
 * was argued in and out of existence twice. The argument ended structurally:
 * the section tree lives in the sidebar column while Settings is the route
 * (see `SettingsTree`), so there is never a second navigation column to make
 * peace with, and this page is only the pane.
 *
 */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)
  const active = section?.id ?? DEFAULT_SECTION

  return (
    <div className="relative h-full overflow-hidden">
      <PageTransition
        view={active}
        className="studio-scroll-inset min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
      >
        <div
          className="studio-content-column studio-settings-column pb-24"
          style={{ paddingTop: SHELL.topStrip.height + 16 }}
        >
          {paneFor(active)}
        </div>
      </PageTransition>
    </div>
  )
}
