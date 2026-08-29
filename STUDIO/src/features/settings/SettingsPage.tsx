import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
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
 * ---- Why the pane fades only on a section change --------------------------
 *
 * This pane used to spread `VIEW_TRANSITION` -- the same entrance the shell's
 * outlet plays. Entering Settings therefore played the entrance twice, stacked:
 * two opacity ramps and two vertical offsets compounding into a hop that read
 * as a rendering fault, not a transition. The page-level handover belongs to
 * the shell (`AppShell`); this file animates only the one change it owns, the
 * section switch, and a pure crossfade at that -- the sidebar's selection chip
 * is already travelling to the new section while it plays, and a second moving
 * part inside the pane would compete with it rather than join it.
 */
const DEFAULT_SECTION = 'general'

export function SettingsPage({ sectionId }: { sectionId: string }) {
  const section = findSection(sectionId) ?? findSection(DEFAULT_SECTION)
  const active = section?.id ?? DEFAULT_SECTION

  // False during the mount, true ever after: the shell owns the entrance, and
  // only a `key` change -- a section switch -- re-runs the one below.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])

  return (
    <div
      className="studio-scroll-inset flex h-full min-h-0 justify-center overflow-y-auto px-8"
      style={{ paddingTop: SHELL.topStrip.height + 16 }}
    >
      <motion.div
        key={active}
        initial={mounted.current ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="w-full pb-24"
        style={{ maxWidth: '36rem' }}
      >
        {paneFor(active)}
      </motion.div>
    </div>
  )
}
