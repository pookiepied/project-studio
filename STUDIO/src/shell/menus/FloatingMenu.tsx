import { forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import { ActionItems } from '@/shell/menus/ActionItems'

/** The menu's width, which its placement has to know before it renders. */
export const MENU_WIDTH = 208
/** The least a floating menu keeps between itself and the window's edge. */
export const EDGE_PADDING = 8

export interface FloatingPlacement {
  readonly x: number
  readonly y: number
  /** The corner the menu grows from, so it arrives from what summoned it. */
  readonly origin: 'top left' | 'bottom left'
  readonly selection: string
  readonly target: HTMLElement | null
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
  return (
    <AnimatePresence>
      {placement ? (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={label}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
          transition={SPRING_SNAPPY}
          style={{
            left: placement.x,
            top: placement.y,
            width: MENU_WIDTH,
            transformOrigin: placement.origin,
          }}
          className="studio-blur fixed z-[60] rounded-lg border p-1 shadow-overlay"
        >
          <ActionItems selection={placement.selection} target={placement.target} close={close} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})
