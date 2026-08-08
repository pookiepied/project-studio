import { Sidebar } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SHELL } from '@/app/shell/shellConfig'

/**
 * An edge bracket framing the content area, carrying the toggle for the panel
 * that will open into it — conversations on the left, context on the right.
 *
 * The panels do not exist yet, so the toggles render disabled with a tooltip
 * rather than opening nothing. The rails hold the layout grid now so adding a
 * panel later does not reflow the shell around it.
 */
export function SideRail({ side }: { side: 'left' | 'right' }) {
  const label = side === 'left' ? 'Conversations' : 'Context'

  return (
    <div
      className="flex shrink-0 flex-col items-center"
      style={{ width: SHELL.rail.width, paddingTop: SHELL.rail.paddingTop }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled
                aria-label={`Toggle ${label.toLowerCase()} panel`}
                className="rounded-md text-muted-foreground"
              >
                {/* Not mirrored: V1 draws this glyph the same way on both
                    sides, and flipping it reads as a different icon. */}
                <Sidebar size="sm" />
              </Button>
            </span>
          }
        />
        <TooltipContent side={side === 'left' ? 'right' : 'left'}>
          {label} panel arrives with its own slice.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
