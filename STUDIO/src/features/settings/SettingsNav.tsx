import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { SelectionChip } from '@/components/primitives'
import { COLLAPSE } from '@/design/tokens'
import { PLACEHOLDERS } from '@/features/settings/panes/placeholders'
import { SETTINGS_GROUPS, groupOf, type SettingsGroup } from '@/features/settings/sections'
import { cn } from '@/lib/cn'

const isPlanned = (sectionId: string) => sectionId in PLACEHOLDERS

/** Where a group opens: its first page with something on it. */
function landingPage(group: SettingsGroup) {
  return group.sections.find((section) => !isPlanned(section.id)) ?? group.sections[0]
}

/**
 * Settings' side panel, inside the Settings page.
 *
 * It belongs to the page rather than to the sidebar column because of Studio's
 * default window: at that size the sidebar is a drawer, and a list kept there
 * was out of sight on the one page that needs it. Here it is always on screen.
 *
 * It lists the seven groups, with the pages of one open beneath it. All 23 pages
 * at once had to scroll; this is at most thirteen rows. The open group follows
 * the route rather than its own state, so a page reached from the palette or a
 * link opens its group, and the panel can never disagree with the page.
 *
 * Where the page is too narrow for two columns, as it is at high UI scales, the
 * same list lies down as one scrolling row above the pane. That is CSS only:
 * see `.studio-settings`.
 *
 * The selection is one element sliding between rows, a `layoutId` rather than a
 * restyled row, so it reads as one object moving through one list.
 */
export function SettingsNav({
  active,
  onSelect,
  onBack,
}: {
  active: string
  onSelect: (sectionId: string) => void
  onBack: () => void
}) {
  // Laid out as a row, the open section can sit off the end of it.
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const openGroup = groupOf(active)

  return (
    <nav ref={nav} aria-label="Settings sections" className="studio-settings-nav">
      <div className="studio-settings-nav-head">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="studio-control-flat studio-settings-nav-row relative flex items-center gap-2 rounded-md px-2 text-left text-ui text-muted-foreground transition-colors duration-fast hover:text-foreground"
        >
          <Icons.back />
          <span className="studio-settings-nav-title">Back</span>
        </button>
      </div>

      {SETTINGS_GROUPS.map((group) => {
        const open = group === openGroup
        // A group of one is its page: nothing to open, and the row is the selection.
        const single = group.sections.length === 1
        return (
          <div key={group.id} className="studio-settings-nav-group">
            <button
              type="button"
              aria-expanded={single ? undefined : open}
              aria-current={single && open ? 'page' : undefined}
              onClick={() => {
                if (!open) onSelect(landingPage(group).id)
              }}
              className={cn(
                'studio-control-flat studio-settings-nav-row relative flex items-center gap-2 rounded-md px-2 text-left',
                'text-ui transition-colors duration-fast',
                open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {single && open ? <SelectionChip list="settings-nav" /> : null}
              <span className="relative flex shrink-0 items-center">
                <group.icon />
              </span>
              <span className="studio-settings-nav-title relative min-w-0 flex-1 truncate">{group.name}</span>
            </button>

            <AnimatePresence initial={false}>
              {open && !single ? (
                <motion.div {...COLLAPSE} className="overflow-hidden">
                  <div className="studio-settings-nav-pages">
                    {group.sections.map((section) => {
                      const selected = section.id === active
                      const planned = isPlanned(section.id)
                      return (
                        <button
                          key={section.id}
                          type="button"
                          title={planned ? `${section.name} (planned)` : section.name}
                          aria-current={selected ? 'page' : undefined}
                          onClick={() => onSelect(section.id)}
                          className={cn(
                            'studio-control-flat studio-settings-nav-row relative flex items-center rounded-md px-2 text-left',
                            'text-ui transition-colors duration-fast',
                            selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                            planned && !selected && 'opacity-60',
                          )}
                        >
                          {selected ? <SelectionChip list="settings-nav" /> : null}
                          <span className="relative min-w-0 truncate">{section.name}</span>
                          {planned ? <span className="sr-only"> (planned)</span> : null}
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )
      })}
    </nav>
  )
}
