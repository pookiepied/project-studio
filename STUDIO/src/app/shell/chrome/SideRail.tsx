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
 *
 * Fix: traffic lights (left:14, 3×10+2×8=46w) previously clashed with the left
 * rail toggle (rail at 0, toggle centered in 32w). Reference
 * `archive/STUDIO/src/features/chat/components/LeftWorkspaceSidebar.tsx:203`
 * places the left toggle at `left:72` (14+46+12 gap) and both traffic lights
 * + left/right toggles share `h-[var(--studio-topbar-height)]` flex-center.
 * This file mirrors that: toggles are `fixed top-0` centered in
 * `SHELL.topBarHeight` (36), left at 72 / right at 14, so no overlap and
 * perfect horizontal alignment with traffic lights and dock.
 */
export function SideRail({ side }: { side: 'left' | 'right' }) {
  const label = side === 'left' ? 'Conversations' : 'Context'
  const isLeft = side === 'left'
  // Left offset 72 clears traffic lights (14+46+12). In browser (no lights) we keep it
  // for consistency with reference; right is 14 from edge as ref `right-3.5`.
  const fixedStyle: React.CSSProperties = isLeft
    ? { left: SHELL.rail.leftToggleLeft, height: SHELL.topBarHeight }
    : { right: SHELL.rail.rightToggleRight, height: SHELL.topBarHeight }

  return (
    <>
      {/* Fixed top-bar toggle — horizontally aligned with traffic lights & dock */}
      <div
        className="pointer-events-auto fixed top-0 z-40 flex items-center justify-center"
        style={fixedStyle}
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
          <TooltipContent side={isLeft ? 'right' : 'left'}>
            {label} panel arrives with its own slice.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Vertical rail spacer framing content below the top bar — keeps layout grid stable */}
      <div className="flex shrink-0" style={{ width: SHELL.rail.width }} aria-hidden />
    </>
  )
}
