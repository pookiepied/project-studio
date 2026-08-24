import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import { ActionItems } from '@/shell/ActionItems'

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

const MENU_WIDTH = 208
const MENU_MAX_HEIGHT = 260
const EDGE_PADDING = 8

interface Position {
  readonly x: number
  readonly y: number
  readonly selection: string
  readonly target: HTMLElement | null
}

export function ActionsMenu() {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Position | null>(null)

  const close = () => setPosition(null)

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      setPosition({
        x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - EDGE_PADDING),
        y: Math.min(event.clientY, window.innerHeight - MENU_MAX_HEIGHT - EDGE_PADDING),
        selection: window.getSelection()?.toString().trim() ?? '',
        target: event.target as HTMLElement | null,
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      // Clicking elsewhere dismisses; clicking the menu itself does not.
      if (menuRef.current?.contains(event.target as Node)) return
      close()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
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
  }, [menuRef, close])

  return (
    <AnimatePresence>
      {position ? (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label={position.selection ? 'selection actions' : 'page actions'}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
          transition={SPRING_SNAPPY}
          style={{ left: position.x, top: position.y, width: MENU_WIDTH, transformOrigin: 'top left' }}
          className="studio-blur fixed z-[60] rounded-lg border p-1 shadow-overlay"
        >
          <ActionItems selection={position.selection} target={position.target} close={close} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
