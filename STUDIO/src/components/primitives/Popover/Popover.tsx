import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
 * ---- Why it renders in a portal -------------------------------------------
 *
 * It used to be `position: absolute` inside the trigger's own box, which is the
 * simple construction and is wrong the moment a trigger sits inside anything
 * that scrolls or clips. Both of ours do: the sidebar's list is
 * `overflow-y-auto`, so a conversation's three-dot menu was clipped by the
 * column it opened in — the panel was rendered correctly and then cut in half
 * by an ancestor, which looks like a layout bug in the menu and is not one.
 *
 * A portal to `document.body` removes the whole class of problem: nothing can
 * clip an element that is not inside it. The position is then measured from the
 * trigger's rect and pinned with `position: fixed`.
 *
 * It also gains the collision handling the old note apologised for. A menu near
 * the bottom of the window flips to open upward, and one near an edge is pulled
 * back inside it. Both are cheap once the panel is measured against the
 * viewport rather than against whatever box it happened to be declared in.
 *
 * ---- Why the panel is measured with offsetWidth, not its rect --------------
 *
 * The panel animates in with a `scale(0.97)` transform, and `getBoundingClientRect`
 * reports the transformed box. Measuring that meant every placement was computed
 * against a panel ~3% smaller than the one that would still be on screen a frame
 * later, and for an end-aligned menu - the kind anchored to a trigger on the
 * window's right edge - that error is all on the left side: the first placement
 * sat a few pixels too far right, and the first reposition after that (any
 * scroll does it) snapped it left. With a long menu the user is scrolling while
 * it is open, so the jump read as "the menu shifts when I scroll the list".
 * `offsetWidth`/`offsetHeight` are layout sizes the transform never touches, so
 * the measurement and the settled panel are the same box.
 *
 * ---- Why placement re-runs when content resizes ---------------------------
 *
 * A menu whose view changes in place - a model picker opening a wider library,
 * a search field narrowing a list - changes its own box without closing, and a
 * position computed for the old box is wrong for the new one. A ResizeObserver
 * on the panel re-places it whenever its content's size moves; guarded to a
 * no-op where the observer does not exist, because a menu that merely keeps its
 * first position beats one that fails to open at all.
 */

type Side = 'top' | 'bottom'
type Align = 'start' | 'end' | 'center'

/** Breathing room between the panel and the trigger, and from the window edge. */
const OFFSET = 6
const MARGIN = 8

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
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; side: Side } | null>(null)

  /**
   * Places the panel against the viewport.
   *
   * Measured after layout and before paint, so the menu never shows for a frame
   * at the wrong coordinates — which is exactly what a `useEffect` here would
   * produce, and it is visible as a flick on every open.
   */
  const place = useCallback(() => {
    const trigger = anchor.current?.getBoundingClientRect()
    const panelElement = panel.current
    if (!trigger || !panelElement) return

    // Layout sizes, not the bounding rect: the rect is multiplied by the
    // entry animation's scale transform, and placing a menu against a box
    // that will not exist a frame later is the shift described above.
    const width = panelElement.offsetWidth
    const height = panelElement.offsetHeight

    // Flip rather than overflow: if the preferred side has no room but the
    // opposite side does, use the opposite side. If neither does, keep the
    // preference and let the clamp below deal with it.
    const below = window.innerHeight - trigger.bottom - OFFSET - MARGIN
    const above = trigger.top - OFFSET - MARGIN
    let resolved = side
    if (side === 'bottom' && height > below && above > below) resolved = 'top'
    if (side === 'top' && height > above && below > above) resolved = 'bottom'

    const top =
      resolved === 'bottom' ? trigger.bottom + OFFSET : trigger.top - height - OFFSET

    const preferred =
      align === 'end'
        ? trigger.right - width
        : align === 'center'
          ? trigger.left + trigger.width / 2 - width / 2
          : trigger.left

    // Pulled back inside the window on both axes. A menu that hangs off the
    // edge is not merely ugly — the rows past the edge cannot be clicked. The
    // bounds are floored at MARGIN so a panel wider than the window clamps to
    // the left edge instead of the min/max pair collapsing and letting it
    // through to the right.
    const left = Math.min(
      Math.max(preferred, MARGIN),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    )
    const clampedTop = Math.min(
      Math.max(top, MARGIN),
      Math.max(MARGIN, window.innerHeight - height - MARGIN),
    )

    setPosition({ top: clampedTop, left, side: resolved })
  }, [align, side])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()

    // The window can be resized and the page scrolled while a menu is open, and
    // a fixed panel does not follow its trigger on its own. `capture` catches
    // scrolls on any ancestor, not just the document — including the menu's
    // own scrolling list, which is why a re-place must be stable rather than
    // slightly different every time.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)

    // Content that resizes in place — a view swapped inside the same open
    // menu, a list shortened by a filter — needs a fresh placement, and no
    // scroll or resize event will announce it.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => place())
    if (panel.current !== null && observer !== undefined) observer.observe(panel.current)

    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return

    // `pointerdown`, not `click`: a click fires after the press has already
    // moved focus, so a menu closing on click flashes its focus ring on the way
    // out. Escape is captured so it closes the nearest popover before a parent
    // surface acts on it.
    // The panel is checked as well as the anchor: in a portal it is no longer a
    // descendant of the trigger, so testing the anchor alone would treat every
    // click *inside the menu* as a click outside it.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchor.current?.contains(target) || panel.current?.contains(target)) return
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
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panel}
              role="menu"
              initial={{ opacity: 0, scale: 0.97, y: (position?.side ?? side) === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              // The mirror of the entrance, and it has to be: the panel came in
              // from 0.97 and 4px off the trigger, so it leaves back to the
              // same place. It used to leave on `fast` - the token for a state
              // change on something already visible - with a 2% scale and no
              // displacement at all. Both halves of that are why picking a
              // model read as the menu cutting out rather than closing: 120ms
              // is under what a dismissal needs to register, and a 2% shrink
              // going nowhere is not a direction the eye can follow.
              exit={{
                opacity: 0,
                scale: 0.97,
                y: (position?.side ?? side) === 'top' ? 4 : -4,
                transition: { duration: DURATION.base, ease: EASE_OUT },
              }}
              transition={SPRING_SNAPPY}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                transformOrigin: (position?.side ?? side) === 'top' ? 'bottom center' : 'top center',
                // Hidden until measured. The panel has to be in the DOM to have
                // a height worth measuring, so it renders first and is placed
                // immediately after — one frame in which it must not be seen.
                visibility: position ? 'visible' : 'hidden',
              }}
              className={cn(
                // `lg` panel with 4px padding puts rows on `sm` — the
                // concentric rule, so the row corners run parallel to the
                // panel's. The max-width is the same hard clamp the placement
                // math applies, said in CSS as well, so a panel can never be
                // the thing that gives the page a horizontal scrollbar.
                'studio-blur fixed z-50 min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border p-1',
                'shadow-overlay',
                className,
              )}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
