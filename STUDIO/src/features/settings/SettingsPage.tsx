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
 * ---- The page is only the pane -------------------------------------------
 *
 * Settings' navigation lives in the sidebar column (see `SettingsNav`), so this
 * page has no section list of its own. It renders the selected pane and nothing
 * else; the column supplies the tree and the way back. The transition covers
 * the pane alone, so moving between sections never disturbs that tree.
 */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)
  const active = section?.id ?? DEFAULT_SECTION

  return (
    <div className="h-full min-h-0" style={{ paddingTop: SHELL.topStrip.height }}>
      <div className="relative h-full min-h-0 overflow-hidden">
        <PageTransition
          view={active}
          className="studio-scroll-inset min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        >
          <div className="studio-content-column studio-settings-column pt-4 pb-24">
            {paneFor(active)}
          </div>
        </PageTransition>
      </div>
    </div>
  )
}
