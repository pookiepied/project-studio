import { useRef, type KeyboardEvent } from 'react'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'
import { cn } from '@/lib/cn'
import { TextField } from './TextField'

export function ClearSearchButton({ onClear, className }: { onClear: () => void; className?: string }) {
  return (
    <IconButton label="Clear search" size="sm" tooltipSide="bottom" onClick={onClear} className={className}>
      <Icons.close />
    </IconButton>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel = placeholder,
  autoFocus,
  onKeyDown,
  appearance = 'field',
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel?: string
  autoFocus?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  appearance?: 'field' | 'menu'
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="relative w-full min-w-0">
      <TextField
        ref={input}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-[var(--button-sm)] pr-[calc(var(--button-sm)+0.375rem)]',
          appearance === 'menu' && 'border-transparent bg-transparent pl-1',
        )}
      />
      {value === '' ? null : (
        <div className="absolute inset-y-0 right-1 flex items-center">
          <ClearSearchButton
            onClear={() => {
              onChange('')
              input.current?.focus()
            }}
          />
        </div>
      )}
    </div>
  )
}
