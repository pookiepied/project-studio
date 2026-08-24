import { useEffect } from 'react'

/**
 * Start typing anywhere and the field takes it.
 *
 * The behaviour Finder and Mail have: with nothing else focused, a printable
 * key means you are addressing the one thing on screen that accepts text.
 *
 * It exists so the composer does not need autofocus. Autofocusing on mount
 * would apply the field's focus styling before anyone had touched it, and the
 * empty state is the whole first impression. This gives back the only thing
 * that costs — you can still type the moment the window opens.
 *
 * Anything that is not plainly typing is left alone: modifier chords, so Cmd+K
 * still reaches the palette, and keystrokes already aimed at a field.
 */
export function useTypeToFocus(enabled: boolean, focus: () => void) {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // A printable character is exactly one code unit; every named key
      // ("Enter", "ArrowLeft", "Escape") is longer.
      if (event.key.length !== 1) return

      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      // Focus only. The keystroke is not replayed and does not need to be —
      // the event has not been consumed, so it lands in the field on its own.
      focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, focus])
}
