import { useEffect, type RefObject } from 'react'

/**
 * Keeps the keyboard inside a modal surface while it is open, and puts it
 * back where it was when the surface closes.
 *
 * Without this, Tab walked straight out of a dialog into the page behind it
 * - the sidebar, the composer - which the scrim was covering and the pointer
 * could not reach. A modal that the pointer cannot leave but the keyboard can
 * is two different surfaces depending on which hand you use.
 *
 * Three things, all on the document rather than on the panel, for the same
 * reason the Overlay binds Escape there: bound to the panel they would work
 * only while focus was already inside it.
 *
 * 1. On open, focus moves into the surface - to the first thing that takes
 *    focus, or to the container itself when nothing does - unless the surface
 *    already put it somewhere (a palette that focuses its field, a rename
 *    that selects its text). Checked a frame late, after the panel's own
 *    effects have run, so this never fights a deliberate autofocus.
 * 2. Tab and Shift+Tab wrap at the surface's edges instead of leaving it.
 * 3. On close, focus returns to the element that had it before the surface
 *    opened, if that element is still on the page. The control that opened a
 *    dialog is where a keyboard user expects to land when it closes.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const frame = requestAnimationFrame(() => {
      const root = container.current
      if (root === null || root.contains(document.activeElement)) return
      const first = focusable(root)[0]
      if (first !== undefined) first.focus()
      else {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
        root.focus()
      }
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const root = container.current
      if (root === null) return
      const items = focusable(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && root.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last?.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [container, open])
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** What Tab would visit inside the root, in document order. */
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )
}
