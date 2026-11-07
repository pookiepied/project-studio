import { useEffect, useRef } from 'react'
import { Icons } from '@/components/icons'
import { SelectionChip } from '@/components/primitives'
import { SETTINGS_GROUPS } from '@/features/settings/sections'
import { cn } from '@/lib/cn'

/**
 * Settings' section list, inside the Settings page.
 *
 * It belongs to the page rather than to the sidebar column because of Studio's
 * default window: at that size the sidebar is a drawer, and a list kept there
 * was out of sight on the one page that needs it. Here it is always on screen.
 * Removing it for one long page was the other option, but twenty-odd sections
 * in one scroll means finding Hooks past everything above it, and starting that
 * search again on every return.
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

      {SETTINGS_GROUPS.map((group) => (
        <div key={group.id} className="studio-settings-nav-group">
          <p className="studio-settings-nav-label text-caption text-muted-foreground">{group.name}</p>

          {group.sections.map((section) => {
            const selected = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onSelect(section.id)}
                className={cn(
                  'studio-control-flat studio-settings-nav-row relative flex items-center gap-2 rounded-md px-2 text-left',
                  'text-ui transition-colors duration-fast',
                  selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {selected ? <SelectionChip list="settings-nav" /> : null}
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
