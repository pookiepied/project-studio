import { useState } from 'react'
import { Check, Expand } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasoningSlider } from '@/features/chat/composer/controls/ReasoningSlider'
import { MODEL_OPTIONS, PEAK_EFFORT, type ModelOption } from '@/features/chat/composer/turnSettings'
import {
  pillButton,
  pillActive,
  pillIdle,
  pillLabel,
  pillValueWidth,
} from '@/features/chat/composer/composerStyles'
import type { Effort } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

/**
 * Model and reasoning in one control.
 *
 * They live together because they are one decision — how this turn should be
 * answered — and splitting them into two pills made the toolbar read as a
 * settings bar rather than a choice. The trigger summarises both; the popover
 * holds the detail.
 */
export function ModelReasoningControl({
  modelId,
  effort,
  onModelChange,
  onEffortChange,
}: {
  modelId: string
  effort: Effort
  onModelChange: (id: string) => void
  onEffortChange: (effort: Effort) => void
}) {
  const [open, setOpen] = useState(false)
  const model = MODEL_OPTIONS.find((option) => option.id === modelId) ?? MODEL_OPTIONS[0]
  const atPeak = effort === PEAK_EFFORT

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(pillButton, open ? pillActive : pillIdle)}
        aria-label={`Model ${model.label}, reasoning ${effort}`}
      >
        <span className={cn(pillLabel, pillValueWidth)}>{model.label}</span>
        <span
          aria-hidden
          className={cn(
            // Fixed width: the levels differ in length, and letting the pill
            // resize shifted every control beside it on each change.
            'inline-flex h-full w-11 items-center justify-center text-[10px] leading-none font-semibold tracking-wide uppercase',
            atPeak
              ? 'bg-linear-to-r from-indigo-500 via-fuchsia-500 to-amber-500 bg-clip-text text-transparent'
              : 'text-muted-foreground',
          )}
        >
          {effort}
        </span>
        <Expand size="xs" className="text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-72">
        <div role="radiogroup" aria-label="Model" className="flex flex-col gap-0.5">
          {MODEL_OPTIONS.map((option) => (
            <ModelRow
              key={option.id}
              option={option}
              selected={option.id === model.id}
              onSelect={() => onModelChange(option.id)}
            />
          ))}
        </div>

        <div className="my-2 h-px bg-border" />

        <ReasoningSlider effort={effort} onChange={onEffortChange} />
      </PopoverContent>
    </Popover>
  )
}

function ModelRow({
  option,
  selected,
  onSelect,
}: {
  option: ModelOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{option.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {option.description}
        </span>
      </span>
      {selected && <Check size="sm" className="shrink-0 text-foreground" />}
    </button>
  )
}
