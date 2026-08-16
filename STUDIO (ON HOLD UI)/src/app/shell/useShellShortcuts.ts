import { useEffect } from 'react'
import { useChrome } from '@/app/shell/ChromeProvider'

/**
 * The window's global keyboard shortcuts, in one listener.
 *
 *   ⌘K / Ctrl+K   command palette
 *   ⌘B / Ctrl+B   sidebar
 *   ⇧⌘B           context panel
 *
 * One listener rather than one per feature, because these have to agree about
 * precedence: ⌘K must not also toggle something, and Escape belongs to
 * whichever overlay is topmost. Scattering them across components makes that
 * ordering implicit and therefore wrong eventually.
 *
 * Shortcuts do not fire while a text field has focus *unless* they carry a
 * modifier — ⌘K in the composer should still open the palette, but a bare key
 * must never steal a keystroke from something you are typing into.
 */
export function useShellShortcuts() {
  const { toggleSidebar, toggleContext, setCommandOpen } = useChrome()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        // Toggle rather than open: pressing the palette's own shortcut again is
        // the fastest way most people dismiss it.
        setCommandOpen((current: boolean) => !current)
        return
      }

      if (key === 'b') {
        event.preventDefault()
        if (event.shiftKey) toggleContext()
        else toggleSidebar()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar, toggleContext, setCommandOpen])
}
