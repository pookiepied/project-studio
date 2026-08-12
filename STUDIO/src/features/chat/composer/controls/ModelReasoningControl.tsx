import { useState } from 'react'
import { Check, Disclosure } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasoningStepper } from '@/features/chat/composer/controls/ReasoningStepper'
import { StableLabel } from '@/features/chat/composer/controls/StableLabel'
import {
  EFFORT_STOPS,
  MODEL_OPTIONS,
  PEAK_EFFORT,
  effortIndex,
  type ModelOption,
} from '@/features/chat/composer/turnSettings'
import {
  pillButton,
  pillActive,
  pillIdle,
} from '@/features/chat/composer/composerStyles'
import type { Effort } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

const MODEL_LABELS = MODEL_OPTIONS.map((option) => option.label)

/**
 * Model and reasoning in one control.
 *
 * They live together because they are one decision — how this turn should be
 * answered — and splitting them into two pills made the toolbar read as a
 * settings bar rather than a choice. The trigger summarises both; the popover
 * holds the detail.
 *
 * The effort summary is four dots rather than the word "medium". At the size
 * this trigger runs, a word is the same visual weight as the model name beside
 * it and competes with it; a filled-dot meter reads as a *quantity* at a
 * glance and takes a quarter of the space.
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(pillButton, open ? pillActive : pillIdle)}
        aria-label={`Model ${model.label}, reasoning ${effort}`}
      >
        <StableLabel value={model.label} candidates={MODEL_LABELS} />
        <EffortDots effort={effort} />
        <Disclosure size="xs" className="rotate-90 opacity-50" aria-hidden />
      </PopoverTrigger>

      <PopoverContent side="top" align="end" className="w-72">
        <div role="radiogroup" aria-label="Model" className="flex flex-col gap-px">
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

        <ReasoningStepper effort={effort} onChange={onEffortChange} />
      </PopoverContent>
    </Popover>
  )
}

/** Effort as a four-dot meter — filled up to the current level. */
function EffortDots({ effort }: { effort: Effort }) {
  const index = effortIndex(effort)

  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
      {EFFORT_STOPS.map((stop, stopIndex) => (
        <span
          key={stop.value}
          className={cn(
            'size-1 rounded-full transition-colors duration-150',
            stopIndex <= index
              ? effort === PEAK_EFFORT
                ? 'bg-foreground'
                : 'bg-foreground/70'
              : 'bg-foreground/20',
          )}
        />
      ))}
    </span>
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
        'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150',
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
