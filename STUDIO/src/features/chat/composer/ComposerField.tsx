import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import { COMPOSER } from '@/design/tokens'

export interface ComposerFieldHandle {
  focus: () => void
}

/**
 * The text area.
 *
 * Starts exactly one line tall and grows with its content. Height is measured
 * and set, never animated: a spring on a measured height overshoots and the
 * caret visibly bounces past where you are typing.
 *
 * `onHeightChange` reports whether the field is past one line, which is what
 * lets the frame move from a capsule to a rounded box. The frame cannot work
 * that out for itself -- it would have to measure the same element twice.
 *
 * Enter sends, Shift+Enter breaks. IME composition is excluded: during a
 * Japanese or Chinese conversion Enter commits the candidate and must not also
 * send the message.
 */
export function ComposerField({
  value,
  onChange,
  onSubmit,
  onMultilineChange,
  placeholder,
  handleRef,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onMultilineChange: (multiline: boolean) => void
  placeholder: string
  handleRef?: Ref<ComposerFieldHandle>
}) {
  const field = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(handleRef, () => ({ focus: () => field.current?.focus() }), [])

  // Layout, not effect. This measures the field and writes its height, and a
  // passive effect runs *after* the browser has painted -- so a paste showed one
  // frame at the previous height and radius before snapping to the right ones.
  // Running before paint means the first frame the user sees is already correct.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return

    // Reset before measuring: `scrollHeight` never reports less than the height
    // the element already has, so without this the field only ever grows.
    element.style.height = 'auto'
    const natural = element.scrollHeight
    const clamped = Math.min(natural, COMPOSER.maxHeight)
    element.style.height = `${clamped}px`
    element.style.overflowY = natural > COMPOSER.maxHeight ? 'auto' : 'hidden'
    // `stable` reserves the thumb gutter whether it is needed or not. Otherwise
    // appearing a scrollbar on a paste changes the content width mid-type and
    // the text jitters left.
    element.style.scrollbarGutter = 'stable'

    // One line plus a pixel of slack, rather than comparing to a hardcoded
    // height: the line box changes with the user's text-size preference.
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20
    onMultilineChange(natural > lineHeight * 1.6)
  }, [value, onMultilineChange])

  return (
    <textarea
      ref={field}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        onSubmit()
      }}
      className={[
        'studio-selectable block w-full resize-none bg-transparent',
        'text-body text-foreground outline-none placeholder:text-muted-foreground/70',
        // No vertical padding: the row centres its children, and padding here
        // would fight that and leave the caret sitting low in the capsule.
        'px-1 py-0',
      ].join(' ')}
    />
  )
}
