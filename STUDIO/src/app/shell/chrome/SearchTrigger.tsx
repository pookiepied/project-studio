import { useChrome } from '@/app/shell/ChromeProvider'
import { Search } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The command palette's visible handle in the title bar.
 *
 * ⌘K is the real interface, but a keyboard-only feature is a feature most
 * people never find. So the palette gets a control that looks like what it
 * does — a search field, not a magnifying-glass button — with the shortcut
 * printed on it. Spotlight, Raycast and Linear all advertise themselves this
 * way, and it costs one row of chrome.
 *
 * It is a button styled as a field, not an actual input: typing happens in the
 * palette, and a field that steals focus then hands it somewhere else is a
 * small betrayal every time.
 */
export function SearchTrigger() {
  const { setCommandOpen } = useChrome()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Search projects and conversations"
            aria-keyshortcuts="Meta+K"
            className="group/search flex h-7 w-[200px] shrink-0 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 text-left transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search size="xs" className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Search…</span>
            <kbd className="shrink-0 rounded-xs border border-border bg-background/60 px-1 font-sans text-[10px] leading-[15px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        }
      />
      <TooltipContent side="bottom">Search everything</TooltipContent>
    </Tooltip>
  )
}
