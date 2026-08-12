import type { ComponentType } from 'react'
import type { IconSize } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { roundIconButton } from '@/features/chat/composer/composerStyles'
import { cn } from '@/lib/utils'

/**
 * An affordance whose feature has not shipped. It renders disabled with a
 * tooltip saying why, rather than silently doing nothing on click — a control
 * that looks live and isn't is worse than one that admits it.
 *
 * Replace the call site outright when the feature lands. Do not add a handler
 * here and keep the component.
 */
export function PendingAction({
  icon: Glyph,
  label,
  reason,
}: {
  icon: ComponentType<{ size?: IconSize; className?: string }>
  label: string
  reason: string
}) {
  return (
    <Tooltip>
      {/* The span is the trigger: a disabled button emits no pointer events, so
          a tooltip bound to it would never open. */}
      <TooltipTrigger
        render={
          <span className="inline-flex">
            <button
              type="button"
              disabled
              aria-label={label}
              className={cn(roundIconButton, 'text-muted-foreground disabled:opacity-50')}
            >
              <Glyph size="sm" />
            </button>
          </span>
        }
      />
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  )
}
