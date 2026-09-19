import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SURFACE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives/IconButton/IconButton'
import { Overlay } from '@/components/primitives/Overlay/Overlay'
import { cn } from '@/lib/cn'

/**
 * A modal sheet: a titled panel with a close button, over the `Overlay`
 * that owns the scrim, the Escape key, the click-out and the portal.
 */
export function Dialog({
  open,
  onClose,
  title,
  footer,
  width = '26rem',
  height,
  layout = 'scroll',
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
  /**
   * `scroll` (the default): the body scrolls as a whole, and the panel is as
   * tall as its content up to the screen. `fill`: the body is a box of the
   * panel's height that does not scroll, for content that scrolls a region
   * of its own - a page with a fixed search field over a list. Without it a
   * child sized to the body's height overflowed the body's own padding, and
   * two scrollbars appeared, one inside the other.
   */
  layout?: 'scroll' | 'fill'
  children: ReactNode
}) {
  return (
    <Overlay open={open} onClose={onClose} className="p-6">
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
        // `EASE_IN`, matching the scrim above it. The house ease-out is
        // front-loaded, which is right for arriving and wrong for
        // leaving: it emptied the panel within the first two frames and
        // then animated nothing for the rest of the duration, which is
        // why the dialog read as vanishing rather than closing even
        // after its duration was corrected. See the token's own note.
        exit={{
          opacity: 0,
          scale: 0.96,
          y: 4,
          transition: { duration: DURATION.base, ease: EASE_IN },
        }}
        transition={SPRING_SURFACE}
        // `width` is a fixed rem a caller chose for a desktop window,
        // and it overrides `w-full` — so on a viewport narrower than
        // the panel, the panel overflowed and this scrim clipped it.
        // `maxWidth` resolves against the scrim's content box, which
        // is what the screen actually is, and the panel narrows
        // instead of being cut off.
        style={{ width, maxWidth: '100%', height }}
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

        <div
          className={cn(
            'min-h-0 flex-1 px-4 pb-4',
            layout === 'fill' ? 'flex flex-col overflow-hidden' : 'studio-scroll-bounded overflow-y-auto',
          )}
        >
          {children}
        </div>

        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </motion.div>
    </Overlay>
  )
}
