import { useState } from 'react'
import { Check, Expand, Permission } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PERMISSION_OPTIONS } from '@/features/chat/composer/turnSettings'
import {
  pillButton,
  pillActive,
  pillIdle,
  pillLabel,
  pillValueWidth,
} from '@/features/chat/composer/composerStyles'
import type { PermissionMode } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

/**
 * How much the turn is allowed to do on its own.
 *
 * The options are named as placeholders on purpose: the permissions slice owns
 * the real policies, and a mode with a confident name that enforces nothing is
 * worse than one that admits it is reserved.
 */
export function PermissionSelector({
  permission,
  onChange,
}: {
  permission: PermissionMode
  onChange: (permission: PermissionMode) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = PERMISSION_OPTIONS.find((option) => option.value === permission)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(pillButton, open ? pillActive : pillIdle)}
        aria-label={`Permission mode: ${selected?.label ?? 'none'}`}
      >
        <Permission size="xs" />
        <span className={cn(pillLabel, pillValueWidth)}>{selected?.label ?? 'Permission'}</span>
        <Expand size="xs" className="text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-60">
        <div role="radiogroup" aria-label="Permission mode" className="flex flex-col gap-0.5">
          {PERMISSION_OPTIONS.map((option) => {
            const active = option.value === permission
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                {active && <Check size="sm" className="shrink-0 text-foreground" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
