import { useEffect, useRef, useState } from 'react'
import { fieldAt } from '@/lib/field'
import { transcriptOf } from '@/shell/menus/ActionItems'
import { FloatingMenu, type FloatingPlacement } from '@/shell/menus/FloatingMenu'

/**
 * The right-click.
 *
 * The webview's own menu offers Back, Reload, View Source and Inspect, which
 * mean nothing here, so `suppressWebviewChrome` blocks it in desktop windows.
 * Nothing stands in for it unless there is something to act on: a text field, or
 * selected text. Elsewhere a right-click does nothing, on purpose; the app's own
 * verbs live in the header and Ctrl K.
 *
 * A selection in a transcript belongs to `SelectionMenu`, whose toolbar is
 * already up beside it.
 */

export function ActionsMenu() {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingPlacement | null>(null)

  const close = () => setPosition(null)

  // The listeners are wired once. `close` is rebuilt every render and used to
  // sit in this effect's dependency list, which tore down and re-added three
  // document listeners on every render of the app's outermost menu. Inside
  // the effect the dismissal calls `setPosition` directly -- a setter React
  // guarantees is stable -- so there is nothing left in here that changes.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      const selection = window.getSelection()?.toString().trim() ?? ''
      const target = event.target instanceof HTMLElement ? event.target : null
      const kind = fieldAt(event.target) ? 'field' : selection ? 'selection' : null
      if (kind === null || (kind === 'selection' && transcriptOf(target) !== null)) {
        setPosition(null)
        return
      }
      setPosition({
        kind,
        x: event.clientX,
        y: event.clientY,
        origin: 'top left',
        selection,
        target,
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      // Clicking elsewhere dismisses; clicking the menu itself does not.
      if (menuRef.current?.contains(event.target as Node)) return
      setPosition(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setPosition(null)
      }
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  return (
    <FloatingMenu
      ref={menuRef}
      placement={position}
      label={position?.kind === 'field' ? 'text field actions' : 'selection actions'}
      close={close}
    />
  )
}
