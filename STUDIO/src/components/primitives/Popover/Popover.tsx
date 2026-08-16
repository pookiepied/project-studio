import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A popover anchored to its trigger.
 *
 * Hand-written rather than pulled from a component library, and that is a
 * decision rather than an omission. Every popover here is the same shape: a
 * small menu, opened by one control, closed by Escape or a click outside,
 * placed along one axis. A headless library brings a full collision-aware
 * floating engine to solve that, plus styling that has to be overridden back to
 * these tokens anyway.
 *
 * The limitation it accepts, stated so nobody finds it as a bug: no collision
 * detection. The panel opens where `side` and `align` say. Callers that sit
 * near a window edge pass the side that opens inward.
 */

type Side = 'top' | 'bottom'
type Align = 'start' | 'end' | 'center'

const SIDE_CLASS: Record<Side, string> = {
  top: 'bottom-full mb-1.5',
  bottom: 'top-full mt-1.5',
}

const ALIGN_CLASS: Record<Align, string> = {
  start: 'left-0',
  end: 'right-0',
  center: 'left-1/2 -translate-x-1/2',
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  side = 'bottom',
  align = 'start',
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  side?: Side
  align?: Align
  children: ReactNode
  className?: string
}) {
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    // `pointerdown`, not `click`: a click fires after the press has already
    // moved focus, so a menu closing on click flashes its focus ring on the way
    // out. Escape is captured so it closes the nearest popover before a parent
    // surface acts on it.
    const onPointerDown = (event: PointerEvent) => {
      if (anchor.current?.contains(event.target as Node)) return
      onOpenChange(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onOpenChange(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onOpenChange])

  return (
    <div ref={anchor} className="relative inline-flex">
      {trigger}
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.98,
              transition: { duration: DURATION.fast, ease: EASE_OUT },
            }}
            transition={SPRING_SNAPPY}
            style={{ transformOrigin: side === 'top' ? 'bottom center' : 'top center' }}
            className={cn(
              // `lg` panel with 4px padding puts rows on `sm` -- the concentric
              // rule, so the row corners run parallel to the panel's.
              'studio-blur absolute z-50 min-w-48 rounded-lg border p-1',
              'shadow-[0_10px_34px_-8px_rgba(0,0,0,0.20)]',
              SIDE_CLASS[side],
              ALIGN_CLASS[align],
              className,
            )}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
