import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * ---- Why it renders in a portal --------------------------------------------
 *
 * A tooltip was `position: absolute` inside its trigger, so any ancestor with
 * `overflow: hidden` cut it in half. The sidebar is one, which made this worst
 * exactly where it matters most: the icon-only controls in a collapsed rail
 * have no other label, and theirs were the ones being clipped by the rail's own
 * edge. A label you cannot finish reading is worse than no label, because the
 * user waited 400ms for it.
 *
 * Portalled to the body and pinned with `fixed`, measured against the viewport
 * and pulled back inside it when it would overhang.
 */
const DELAY_MS = 400
const OFFSET = 8
const MARGIN = 8

type Side = 'right' | 'top' | 'bottom'

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
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const trigger = anchor.current?.getBoundingClientRect()
    const box = bubble.current?.getBoundingClientRect()
    if (!trigger || !box) return

    const top =
      side === 'right'
        ? trigger.top + trigger.height / 2 - box.height / 2
        : side === 'top'
          ? trigger.top - box.height - OFFSET
          : trigger.bottom + OFFSET

    const left =
      side === 'right'
        ? trigger.right + OFFSET
        : trigger.left + trigger.width / 2 - box.width / 2

    setPosition({
      top: Math.min(Math.max(top, MARGIN), window.innerHeight - box.height - MARGIN),
      left: Math.min(Math.max(left, MARGIN), window.innerWidth - box.width - MARGIN),
    })
  }, [side])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()
  }, [open, place])

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
      ref={anchor}
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
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.span
              ref={bubble}
              role="tooltip"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                visibility: position ? 'visible' : 'hidden',
              }}
              className={cn(
              // Inverted, and solid. A translucent panel tinted from the same
              // surface it floats over is the one thing a tooltip must not be:
              // it borrows the colour of whatever is behind it, so the label
              // half-dissolves into the row it is explaining. `--primary` is
              // near-black in light and near-white in dark, so the capsule
              // flips with the theme and always reads as a separate object
              // rather than a lighter patch of the same one.
                'pointer-events-none fixed z-50 whitespace-nowrap rounded-lg px-2 py-1',
                'bg-primary text-primary-foreground',
                'text-caption shadow-overlay',
              )}
            >
              {label}
            </motion.span>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  )
}
