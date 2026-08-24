import { motion } from 'framer-motion'
import { SETTINGS_GROUPS } from '@/features/settings/sections'
import { SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The settings rail.
 *
 * ---- The two-sidebar objection, and why this is not that ------------------
 *
 * There used to be a rail here, it was removed, and the note that replaced it
 * argued that Settings must be one scrolling document because a second nav
 * column beside the app's own is "two lists of destinations and neither is
 * obviously in charge".
 *
 * The objection was right about symmetry and wrong about the fix. Twenty
 * sections in one scroll is not a simpler answer, it is the absence of one:
 * finding Hooks means scrolling past Voice, Personalization and four things
 * about providers, and the page has no state, so leaving and returning starts
 * the search over. Every desktop app with this many preferences has a rail,
 * and none of them are confusing, because the two columns are not peers.
 *
 * What makes them not peers is stated visually rather than argued about. The
 * rail paints no fill and no border — it is text on the page's own surface,
 * where the app sidebar is a distinct sunken column with a background. One is
 * furniture; the other is a list inside a document. And it is scoped: it
 * appears only within Settings and lists only settings, so at no point are
 * there two columns offering the same kind of destination.
 *
 * The selection is a moving chip rather than a restyled row. A `layoutId`
 * animates the *same* element between positions, so the selection reads as one
 * object sliding down the list — which is a statement that these are views of
 * one page, not four pages that happen to be adjacent.
 */
export function SettingsNav({
  active,
  onSelect,
}: {
  active: string
  onSelect: (sectionId: string) => void
}) {
  return (
    <nav aria-label="Settings sections" className="flex w-52 shrink-0 flex-col gap-6 pb-16">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col">
          <p className="mb-1.5 px-2.5 text-micro text-muted-foreground/80 uppercase">{group.name}</p>

          {group.sections.map((section) => {
            const selected = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onSelect(section.id)}
                className={cn(
                  'relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left',
                  'text-ui transition-colors duration-fast',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {/* Behind the label, and shared across the whole rail.
                    Painted as a background on the row instead, the selection
                    would appear and disappear in two places at once rather
                    than travel. */}
                {selected ? (
                  <motion.span
                    layoutId="settings-nav-selection"
                    transition={SPRING_SNAPPY}
                    aria-hidden
                    className="absolute inset-0 rounded-lg bg-selected"
                  />
                ) : null}

                <span className="relative flex items-center">
                  <section.icon />
                </span>
                <span className="relative min-w-0 truncate">{section.name}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
