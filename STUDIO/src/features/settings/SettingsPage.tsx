import { PageTransition } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { paneFor } from '@/features/settings/panes/registry'
import { findSection } from '@/features/settings/sections'
import { SettingsNav } from '@/features/settings/SettingsNav'
import { useNavigation } from '@/stores/navigation'

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
 * ---- Two columns, inside the page ---------------------------------------
 *
 * The section list sits beside the pane, as part of this page: see
 * `SettingsNav` for why. The transition covers the pane alone, so moving between
 * sections never moves the list.
 */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const { openSettings, leaveSettings } = useNavigation()
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)
  const active = section?.id ?? DEFAULT_SECTION

  return (
    <div className="studio-settings-frame h-full" style={{ paddingTop: SHELL.topStrip.height }}>
      <div className="studio-settings">
        <SettingsNav active={active} onSelect={openSettings} onBack={leaveSettings} />
        <div className="relative min-h-0 min-w-0 overflow-hidden">
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
    </div>
  )
}
