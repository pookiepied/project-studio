import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL, SPRING_SURFACE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'
import { cn } from '@/lib/cn'

/**
 * A modal sheet.
 *
 * Escape is bound to the document rather than to the panel, because bound to
 * the panel it works only while focus is inside it — which is every time
 * except the one that matters, after focus has drifted to a menu the sheet
 * opened.
 *
 * The overlay is `fixed`, not `absolute`. Absolute measures itself against
 * the nearest positioned ancestor, and dialogs are opened from all over the
 * shell — including the top strip, a fifty-pixel positioned bar, where the
 * sheet once opened as a sliver inside it. Fixed means the viewport, whatever
 * the mount point's ancestors are doing.
 *
 * ---- Why it is also portalled -----------------------------------------------
 *
 * `fixed` alone did not keep that promise. A transformed or filtered ancestor
 * becomes the containing block for its fixed descendants, and the page every
 * settings sheet opens over is a `motion.main` that animates on every
 * navigation — so `inset-0` resolved to the page rather than to the window.
 * The scrim stopped at the sidebar's edge, which is why its blur read as cut
 * in half: it was not clipped, it was correctly covering a box that was the
 * wrong box. The same ancestor's `overflow-hidden` would have clipped it
 * anyway.
 *
 * A portal to `document.body` removes the ancestor, and with it the whole
 * class of problem — the same move `Popover`, `Tooltip` and the lightbox
 * already make for the same reason. The window's corner is then drawn here
 * rather than inherited, because the OS window is transparent and a square
 * scrim over a rounded panel paints into the corners the panel cut away.
 */
export function Dialog({
  open,
  onClose,
  title,
  footer,
  width = '26rem',
  height,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  footer?: ReactNode
  width?: string
  /**
   * A definite height, for sheets whose content must scroll independently
   * inside itself. Without one the panel is as tall as its content and the
   * sheet scrolls as a whole; a library with two columns that scroll
   * separately needs the box itself to be of known height first.
   */
  height?: string
  children: ReactNode
}) {
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          className="studio-blur-scrim fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-scrim p-6"
          // The window's own corner, restated. Portalled to the body, the
          // scrim no longer inherits the rounded panel's clip, and the OS
          // window behind it is transparent.
          style={{ borderRadius: SHELL.windowRadius }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            // Leaving takes as long as the scrim behind it, and travels far
            // enough to read as leaving. It used to exit in `fast` while the
            // scrim faded over `base`: the panel was gone a third of the way
            // through, so what you actually saw was the box blinking out and
            // then a scrim fading behind nothing. That is what "it just
            // closes, there is no transition" describes - not a missing
            // animation, a dismissal whose two halves were not the same
            // length.
            exit={{
              opacity: 0,
              scale: 0.96,
              y: 4,
              transition: { duration: DURATION.base, ease: EASE_OUT },
            }}
            transition={SPRING_SURFACE}
            style={{ width, height }}
            className={cn(
              'studio-blur flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border',
              'shadow-modal',
            )}
          >
            <header className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2">
              <h2 className="studio-heading text-foreground">{title}</h2>
              <IconButton label="Close" size="sm" onClick={onClose}>
                <Icons.close size="sm" />
              </IconButton>
            </header>

            <div className="studio-scroll-bounded min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>

            {footer ? (
              <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
