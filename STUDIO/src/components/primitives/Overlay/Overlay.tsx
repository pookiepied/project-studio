import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, SHELL } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { useFocusTrap } from './useFocusTrap'

/**
 * The scrim every modal surface opens over.
 *
 * Three surfaces -- the dialog, the media lightbox, the command palette --
 * each drew the same blurred scrim, bound Escape to the document, closed on
 * a click that landed on the scrim itself, and portalled to the body. What
 * differs between them is the panel: its geometry, its entrance, where it
 * sits. So the panel stays with the caller and everything around it is here.
 *
 * Escape is bound to the document rather than to the panel, because bound to
 * the panel it works only while focus is inside it — which is every time
 * except the one that matters, after focus has drifted to a menu the sheet
 * opened, or into a video player's own controls.
 *
 * The scrim is `fixed`, not `absolute`. Absolute measures itself against the
 * nearest positioned ancestor, and surfaces are opened from all over the
 * shell — including the top strip, a fifty-pixel positioned bar, where a
 * sheet once opened as a sliver inside it. Fixed means the viewport,
 * whatever the mount point's ancestors are doing.
 *
 * ---- Why it is also portalled ---------------------------------------------
 *
 * `fixed` alone did not keep that promise. A transformed or filtered ancestor
 * becomes the containing block for its fixed descendants, and the page every
 * settings sheet opens over is a `motion.main` that animates on every
 * navigation — so `inset-0` resolved to the page rather than to the window.
 * The scrim stopped at the sidebar's edge, which is why its blur read as cut
 * in half: it was not clipped, it was correctly covering a box that was the
 * wrong box. A portal to `document.body` removes the ancestor, and with it
 * the whole class of problem — the same move `Popover` and `Tooltip` make.
 * The window's corner is then drawn here rather than inherited, because the
 * OS window is transparent and a square scrim over a rounded panel paints
 * into the corners the panel cut away.
 *
 * The keyboard stays inside while the surface is open, and goes back to the
 * control that opened it when it closes (`useFocusTrap`). The pointer cannot
 * leave a modal; neither should Tab.
 *
 * The scrim leaves on `EASE_IN` over `base`. A panel that leaves in the same
 * time on the same ease reads as closing; one that leaves faster reads as
 * blinking out with a scrim fading behind nothing -- see `Dialog`.
 */
export function Overlay({
  open,
  onClose,
  anchor = 'center',
  raised = false,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Centred, or held near the top the way a command palette sits. */
  anchor?: 'center' | 'top'
  /** Above the ordinary modal layer: a lightbox opened from inside a dialog. */
  raised?: boolean
  /** The scrim's padding, which is the room the panel has to breathe in. */
  className?: string
  children: ReactNode
}) {
  const scrim = useRef<HTMLDivElement | null>(null)
  useFocusTrap(scrim, open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={scrim}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_IN }}
          className={cn(
            'studio-blur-scrim fixed inset-0 flex justify-center overflow-hidden bg-scrim',
            anchor === 'top' ? 'items-start' : 'items-center',
            raised ? 'z-[60]' : 'z-50',
            className,
          )}
          style={{ borderRadius: SHELL.windowRadius }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
