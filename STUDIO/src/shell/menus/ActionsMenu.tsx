import { useEffect, useRef, useState } from 'react'
import { EDGE_PADDING, FloatingMenu, MENU_WIDTH, type FloatingPlacement } from '@/shell/menus/FloatingMenu'

/**
 * The right-click menu.
 *
 * It replaces the webview's own, which offers Back, Reload, View Source and
 * Inspect — commands from a document viewer, in an app with no address bar,
 * several of which do visible damage. `suppressWebviewChrome` blocks that menu
 * in every environment; this is what appears instead, styled like the rest of
 * the app and carrying app-native verbs.
 *
 * The contents change with what is under the pointer. With a selection it is
 * about the text: copy it, select it all, or ask about it as a new conversation.
 * With no selection it is about the app: a new conversation, a reload of the
 * interface, search, and settings.
 *
 * The verbs themselves are shared with the selection menu through
 * `ActionItems`, so the two cannot drift apart — they are the same list of
 * actions, summoned two ways, and the duplication that preceded the shared
 * component was how one would eventually change without the other.
 *
 * Placement is clamped to the window rather than left to overflow, because a
 * context menu opens wherever the pointer happens to be, and near the bottom
 * edge that is off screen.
 */

const MENU_MAX_HEIGHT = 260

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
      setPosition({
        x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - EDGE_PADDING),
        y: Math.min(event.clientY, window.innerHeight - MENU_MAX_HEIGHT - EDGE_PADDING),
        origin: 'top left',
        selection: window.getSelection()?.toString().trim() ?? '',
        target: event.target as HTMLElement | null,
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
      label={position?.selection ? 'selection actions' : 'page actions'}
      close={close}
    />
  )
}
