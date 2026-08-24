import { motion } from 'framer-motion'
import { SHELL, VIEW_TRANSITION } from '@/design/tokens'
import { SettingsNav } from '@/features/settings/SettingsNav'
import { paneFor } from '@/features/settings/panes/registry'
import { findSection } from '@/features/settings/sections'
import { useNavigation } from '@/stores/navigation'

/**
 * Settings: one page, one section at a time.
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
 * The pane is keyed by section, so switching plays the same short rise every
 * other view change in the app plays. The rail is not keyed and does not
 * animate: navigation that redraws itself when you use it is navigation you
 * cannot use twice quickly.
 */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const { openSettings } = useNavigation()
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)
  const active = section?.id ?? DEFAULT_SECTION

  return (
    <div
      className="studio-scroll-inset flex h-full min-h-0 justify-center gap-10 overflow-y-auto px-8"
      style={{ paddingTop: SHELL.topStrip.height + 16 }}
    >
      {/* Sticky rather than scrolling away with the pane. A section's content
          can be long, and a rail that leaves the screen means switching
          sections requires scrolling back up to the navigation first. */}
      <div className="sticky top-0 self-start">
        <SettingsNav active={active} onSelect={openSettings} />
      </div>

      <motion.div
        key={active}
        {...VIEW_TRANSITION}
        className="w-full pb-24"
        style={{ maxWidth: '36rem' }}
      >
        {paneFor(active)}
      </motion.div>
    </div>
  )
}
