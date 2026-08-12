import { useEffect, useRef, type KeyboardEvent } from 'react'

/** Tallest the field grows before it scrolls internally (px). */
const MAX_HEIGHT = 208

/**
 * The message field. Grows with its content up to a ceiling, then scrolls
 * inside itself rather than pushing the toolbar off screen.
 */
export function ComposerInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Reset to `auto` before measuring so the field shrinks again on delete.
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a newline. `isComposing` is the only reliable
    // signal that an IME is mid-word, and submitting there would eat the input.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    onSubmit()
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      disabled={disabled}
      rows={1}
      placeholder="Ask Studio anything…"
      aria-label="Message"
      className="studio-selectable block max-h-52 w-full resize-none bg-transparent px-2 pt-2 pb-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
    />
  )
}
