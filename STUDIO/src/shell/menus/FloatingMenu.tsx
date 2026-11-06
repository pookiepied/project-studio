import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { floatingMotion } from '@/design/tokens'
import { ActionItems, type ActionKind } from '@/shell/menus/ActionItems'
import { floatingViewport, observeFloating, placeFloating } from '@/design/layout/floating'

/** The menu's width, which its placement has to know before it renders. */
export const MENU_WIDTH = 208
/** The least a floating menu keeps between itself and the window's edge. */
export const EDGE_PADDING = 8

export interface FloatingPlacement {
  readonly x: number
  readonly y: number
  /** The corner the menu grows from, so it arrives from what summoned it. */
  readonly origin: 'top left' | 'bottom left'
  /** Which list: the field's verbs, the selection's, or the page's. */
  readonly kind: ActionKind
  readonly selection: string
  readonly target: HTMLElement | null
  readonly anchor?: DOMRect
}

/**
 * The panel the right-click menu and the selection menu share.
 *
 * The two are one list of verbs (`ActionItems`) summoned two ways, and until
 * this file they were also one panel drawn twice: the same width, the same
 * blur, the same spring in and fade out. What stays with each caller is what
 * genuinely differs -- how it decides where to open and what dismisses it,
 * which for the selection menu is seven document listeners with a memory of
 * the last Escape, and for the right-click menu is three.
 *
 * The ref is the caller's, because the caller's listeners need to ask
 * whether an event landed inside the menu.
 */
export const FloatingMenu = forwardRef<
  HTMLDivElement,
  { placement: FloatingPlacement | null; label: string; close: () => void }
>(function FloatingMenu({ placement, label, close }, ref) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<ReturnType<typeof placeFloating> | null>(null)
  useLayoutEffect(() => {
    if (!placement) return
    const place = () => {
      const element = panel.current
      if (!element) return
      setPosition(placeFloating({
        anchor: placement.anchor ?? { left: placement.x, top: placement.y, width: 0, height: 0 },
        panel: { width: element.offsetWidth, height: element.scrollHeight },
        viewport: floatingViewport(), side: placement.anchor ? 'top' : 'bottom',
        align: placement.anchor ? 'center' : 'start', gap: placement.anchor ? 8 : 0,
      }))
    }
    place()
    return observeFloating(null, panel.current, place)
  }, [placement])
  return (
    <AnimatePresence>
      {placement ? (
        <motion.div
          ref={(element) => {
            panel.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          role="menu"
          aria-label={label}
          {...floatingMotion()}
          style={{
            left: position?.left ?? placement.x,
            top: position?.top ?? placement.y,
            maxWidth: position?.maxWidth,
            maxHeight: position?.maxHeight,
            width: MENU_WIDTH,
            transformOrigin: position?.side === 'top' ? 'bottom left' : placement.origin,
          }}
          className="studio-blur studio-floating-surface fixed z-[60] rounded-lg border p-1 shadow-overlay"
        >
          <ActionItems kind={placement.kind} selection={placement.selection} target={placement.target} close={close} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})
