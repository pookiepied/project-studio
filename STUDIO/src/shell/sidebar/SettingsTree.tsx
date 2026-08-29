import { motion } from 'framer-motion'
import { SETTINGS_GROUPS } from '@/features/settings/sections'
import { SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The settings tree, as the sidebar column's content.
 *
 * ---- The argument, twice had, and how it ends ------------------------------
 *
 * This list used to be a rail inside the Settings page. Before that it had been
 * removed, on the argument that a second nav column beside the app's own is
 * "two lists of destinations and neither is obviously in charge". It came back,
 * because the replacement -- every section in one scrolling document -- is not
 * a simpler answer but the absence of one: finding Hooks means scrolling past
 * Voice, Personalization and four things about providers, and a page with no
 * navigation state restarts the search on every return. Both objections were
 * right, and the returned rail spent a paragraph of visual devices -- no fill,
 * no border, a scoped list -- arguing that two columns did not feel like two
 * columns.
 *
 * The resolution is structural, so the arguing stops: entering Settings
 * replaces the conversation list with this tree *in the same column*. There are
 * never two lists on screen to rank, because there is never more than one
 * column, and the column holds where you can go -- one list at a time. The rail
 * lost nothing it had won: the groups, the rows, the same data in
 * `SETTINGS_GROUPS`, all of it moved here. What went away was the second
 * column.
 *
 * ---- The moving chip -------------------------------------------------------
 *
 * The selection is a sliding chip rather than a restyled row. A `layoutId`
 * animates the *same* element between positions, so the selection reads as one
 * object travelling down the tree -- a statement that these are views of one
 * page, not sixteen pages that happen to share a column.
 */
export function SettingsTree({
  active,
  onSelect,
}: {
  active: string
  onSelect: (sectionId: string) => void
}) {
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-5 pb-2">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col">
          <p className="mb-1 px-2 text-micro uppercase text-muted-foreground/80">{group.name}</p>

          {group.sections.map((section) => {
            const selected = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onSelect(section.id)}
                className={cn(
                  'relative flex h-8 items-center gap-2 rounded-md px-2 text-left',
                  'text-ui transition-colors duration-fast',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {/* Behind the label, and shared across the whole tree.
                    Painted as a background on the row instead, the selection
                    would appear and disappear in two places at once rather
                    than travel. */}
                {selected ? (
                  <motion.span
                    layoutId="settings-tree-selection"
                    transition={SPRING_SNAPPY}
                    aria-hidden
                    className="absolute inset-0 rounded-md bg-selected"
                  />
                ) : null}

                <span className="relative flex shrink-0 items-center">
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
