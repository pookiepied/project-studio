import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SURFACE } from '@/design/tokens'
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
 */
export function Dialog({
  open,
  onClose,
  title,
  footer,
  width = '26rem',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  footer?: ReactNode
  width?: string
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

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          className="studio-blur-scrim absolute inset-0 z-50 flex items-center justify-center bg-scrim p-6"
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
            exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } }}
            transition={SPRING_SURFACE}
            style={{ width }}
            className={cn(
              'studio-blur flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border',
              'shadow-modal',
            )}
          >
            <header className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2">
              <h2 className="studio-heading text-foreground">{title}</h2>
              <IconButton label="Close" size="sm" onClick={onClose}>
                <Icons.close />
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
    </AnimatePresence>
  )
}
