import type { ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'

/**
 * A value moved one step at a time: minus, the value, plus.
 *
 * The choices are a fixed list rather than a range, so a step can be uneven
 * (100, 110, 125) and a stored value is always one the app offers. A value that
 * is no longer in the list steps to its nearest neighbour instead of sticking.
 */
export function Stepper<T extends number>({
  label,
  value,
  choices,
  onChange,
  format = (choice) => String(choice),
}: {
  /** What is being changed, for the buttons' names: "Decrease text size". */
  readonly label: string
  readonly value: T
  readonly choices: readonly T[]
  readonly onChange: (value: T) => void
  readonly format?: (value: T) => ReactNode
}) {
  const lower = choices.filter((choice) => choice < value).at(-1)
  const higher = choices.find((choice) => choice > value)
  // Mid-sentence, but an initialism keeps its capitals: "Increase UI scale".
  const named = /^[A-Z]{2}/.test(label) ? label : label.toLowerCase()

  return (
    <div role="group" aria-label={label} className="studio-stepper">
      <IconButton
        size="sm"
        label={`Decrease ${named}`}
        disabled={lower === undefined}
        onClick={() => {
          if (lower !== undefined) onChange(lower)
        }}
      >
        <Icons.subtract size="sm" />
      </IconButton>
      <output aria-live="polite" className="studio-stepper-value text-ui font-medium text-foreground">
        {format(value)}
      </output>
      <IconButton
        size="sm"
        label={`Increase ${named}`}
        disabled={higher === undefined}
        onClick={() => {
          if (higher !== undefined) onChange(higher)
        }}
      >
        <Icons.add size="sm" />
      </IconButton>
    </div>
  )
}
