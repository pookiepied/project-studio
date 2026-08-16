import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A tooltip.
 *
 * Load-bearing rather than decorative: icon-only controls have no label of
 * their own, so this is the only thing that says what a glyph does. It replaces
 * the `title` attribute -- which renders the OS's own web tooltip, a chunk of
 * unstyled browser chrome dropped into an otherwise consistent surface.
 *
 * The delay matters. Instant tooltips fire while the pointer is merely crossing
 * a row on its way somewhere else, which turns a quiet column into a strobe.
 * 400ms is long enough that the pointer has stopped, and the group keeps no
 * shared "already warmed" state -- each trigger waits on its own, because
 * skipping the delay for the second one is what makes a strip feel twitchy.
 *
 * Keyboard focus opens it too, gated on `:focus-visible` so a click that lands
 * focus does not pop a label over the thing that was just clicked.
 */

const DELAY_MS = 400

type Side = 'right' | 'top' | 'bottom'

const SIDE_CLASS: Record<Side, string> = {
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
}

export function Tooltip({
  label,
  side = 'top',
  children,
}: {
  label: string
  side?: Side
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | null>(null)

  const clear = () => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }

  const schedule = () => {
    clear()
    timer.current = window.setTimeout(() => setOpen(true), DELAY_MS)
  }

  const dismiss = () => {
    clear()
    setOpen(false)
  }

  useEffect(() => clear, [])

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={schedule}
      onPointerLeave={dismiss}
      // A tooltip that survives the click it labelled sits over the thing the
      // click just revealed.
      onPointerDown={dismiss}
      onFocus={(event) => {
        if (!event.currentTarget.matches(':focus-visible')) return
        schedule()
      }}
      onBlur={dismiss}
    >
      {children}
      <AnimatePresence>
        {open ? (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className={cn(
              // Inverted, and solid. A translucent panel tinted from the same
              // surface it floats over is the one thing a tooltip must not be:
              // it borrows the colour of whatever is behind it, so the label
              // half-dissolves into the row it is explaining. `--primary` is
              // near-black in light and near-white in dark, so the capsule
              // flips with the theme and always reads as a separate object
              // rather than a lighter patch of the same one.
              'pointer-events-none absolute z-50 whitespace-nowrap rounded-lg px-2 py-1',
              'bg-primary text-primary-foreground',
              'text-caption shadow-overlay',
              SIDE_CLASS[side],
            )}
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  )
}
