import { Sidebar } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChrome } from '@/app/shell/ChromeProvider'
import { cn } from '@/lib/utils'

/**
 * A rail toggle in the title bar — left for the sidebar, right for context.
 *
 * This used to be a `position: fixed` element that animated its own `left` /
 * `right` to track the rail it controlled, computed from panel widths in
 * `shellConfig`. It looked correct in isolation and collided with real content
 * in practice: with the sidebar open the left toggle landed on the sidebar's
 * own search button, and the right one on the project tab strip.
 *
 * Now it is a button in a flex row. It does not move, so there is nothing to
 * keep in sync and nothing to collide with. The rail animates; its toggle
 * stays put, which is also the more honest signal — the control is a fixed
 * part of the chrome, not a thing attached to the panel.
 */
export function PanelToggle({ side }: { side: 'left' | 'right' }) {
  const { sidebarOpen, toggleSidebar, contextOpen, toggleContext } = useChrome()
  const isLeft = side === 'left'
  const open = isLeft ? sidebarOpen : contextOpen
  const onToggle = isLeft ? toggleSidebar : toggleContext
  const label = isLeft ? 'sidebar' : 'context'
  const shortcut = isLeft ? '⌘B' : '⇧⌘B'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
            aria-expanded={open}
            aria-keyshortcuts={isLeft ? 'Meta+B' : 'Meta+Shift+B'}
            onClick={onToggle}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // Open is the resting state, so it is the *quiet* one. Lighting
              // up the toggle whenever the sidebar is showing would mean the
              // chrome is highlighted almost all the time.
              open
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'bg-muted/70 text-foreground hover:bg-muted',
            )}
          >
            {/* Not mirrored: one glyph serves both sides; flipping it reads as
                a different icon. */}
            <Sidebar size="sm" />
          </button>
        }
      />
      <TooltipContent side="bottom">
        {open ? `Hide ${label}` : `Show ${label}`}
        <span className="ml-1 text-background/60">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  )
}
