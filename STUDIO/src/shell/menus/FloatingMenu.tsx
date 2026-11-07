import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PILL_MOTION } from '@/design/tokens'
import { ActionItems, type ActionKind } from '@/shell/menus/ActionItems'
import { floatingViewport, observeFloating, placeFloating } from '@/design/layout/floating'
import type { SpellingTarget } from '@/lib/spelling'

/** The least a floating menu keeps between itself and the window's edge. */
export const EDGE_PADDING = 8

export interface FloatingPlacement {
  readonly x: number
  readonly y: number
  /** The corner the menu grows from, so it arrives from what summoned it. */
  readonly origin: 'top left' | 'bottom left'
  /** Which list: the field's verbs or the selection's. */
  readonly kind: ActionKind
  readonly selection: string
  readonly target: HTMLElement | null
  readonly spellingTarget?: SpellingTarget | null
  readonly anchor?: DOMRect
}

/**
 * The toolbar the right-click and the selection share.
 *
 * What stays with each caller is what genuinely differs: how it decides where
 * to open and what dismisses it. The ref is the caller's, because the caller's
 * listeners need to ask whether an event landed inside.
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
          role="toolbar"
          aria-label={label}
          {...PILL_MOTION}
          style={{
            left: position?.left ?? placement.x,
            top: position?.top ?? placement.y,
            maxWidth: position?.maxWidth,
            maxHeight: position?.maxHeight,
            transformOrigin: position?.side === 'top' ? 'center bottom' : 'center top',
          }}
          className="studio-action-bar fixed z-[60]"
        >
          <ActionItems kind={placement.kind} selection={placement.selection} target={placement.target}
            spellingTarget={placement.spellingTarget} close={close} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})
