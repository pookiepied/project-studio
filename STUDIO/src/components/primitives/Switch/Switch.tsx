import { cn } from '@/lib/cn'

/**
 * The on/off control, as Family A draws it: a small blue track and a white knob.
 *
 * `resting` keeps a disabled switch at full strength, for a control shown as
 * the reference shows it before its feature exists.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  resting = false,
  className,
}: {
  checked: boolean
  onChange?: (checked: boolean) => void
  label: string
  disabled?: boolean
  resting?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex h-[19px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-fast',
        checked ? 'bg-accent' : 'bg-switch-off',
        disabled && 'pointer-events-none',
        disabled && !resting && 'opacity-45',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-[2px] size-[15px] rounded-full bg-white shadow-sm transition-transform duration-fast',
          checked && 'translate-x-[11px]',
        )}
      />
    </button>
  )
}
