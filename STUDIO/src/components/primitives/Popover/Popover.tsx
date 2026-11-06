import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { floatingViewport, observeFloating, placeFloating, type FloatingAlign, type FloatingSide } from '@/design/layout/floating'

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

type Side = Exclude<FloatingSide, 'right'>
type Align = FloatingAlign

/** Breathing room between the panel and the trigger, and from the window edge. */
const OFFSET = 6

export function Popover({
  open,
  onOpenChange,
  trigger,
  side = 'bottom',
  align = 'start',
  offset = OFFSET,
  maxWidth,
  maxHeight,
  children,
  className,
  inline = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  side?: Side
  align?: Align
  /**
   * Distance from the trigger's edge. The default suits a bare button; a
   * trigger sitting inside a bordered surface passes the surface's padding
   * plus a gap, so the panel opens off the surface's edge rather than off
   * the button's, where it would sit on the surface's border.
   */
  offset?: number
  /** Optional content cap; the visible viewport remains the upper bound. */
  maxWidth?: string
  /** Optional content cap; the visible viewport remains the upper bound. */
  maxHeight?: string
  children: ReactNode
  className?: string
  inline?: boolean
}) {
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const focusedInline = useRef(false)
  const [position, setPosition] = useState<ReturnType<typeof placeFloating> | null>(null)

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
    setPosition(placeFloating({
      anchor: trigger,
      panel: { width: panelElement.offsetWidth, height: panelElement.offsetHeight },
      viewport: floatingViewport(), side, align, gap: offset,
    }))
  }, [align, offset, side])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()

    return observeFloating(anchor.current, panel.current, place)
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
      if (inline && event.key !== 'Escape' && panel.current?.contains(document.activeElement)) {
        const items = [...panel.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
        const index = items.findIndex((item) => item === document.activeElement)
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length
          : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
        if (next !== null) {
          event.preventDefault()
          items[next]?.focus()
        }
      }
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onOpenChange(false)
      if (inline) anchor.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onOpenChange, inline])

  useEffect(() => {
    if (!open) { focusedInline.current = false; return }
    // A panel cannot accept focus until its measured position makes it visible.
    if (!inline || position === null || focusedInline.current) return
    focusedInline.current = true
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, inline, position])

  // An inline anchor stays plain inline. As `inline-flex` it made every prose
  // link a flex box: a long link could no longer wrap across lines, and a
  // citation pill inside it was blockified and pushed its line apart. The
  // panel is portaled and placed from the anchor's rect, so it needs nothing
  // from the anchor's display.
  const Anchor = inline ? 'span' : 'div'
  return (
    <Anchor ref={(element) => { anchor.current = element }} className={inline ? 'relative' : 'relative inline-flex'}>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panel}
              role="menu"
              initial={{ opacity: 0, scale: 0.97, y: (position?.side ?? side) === 'top' ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              // Retraces the entrance - back to 0.97, back toward the trigger
              // - but on `EASE_IN`, not the house curve. That is the whole
              // difference between a menu that closes and a menu that cuts
              // out: `EASE_OUT` is front-loaded, so it took the panel to 38%
              // opacity within two frames and spent the rest of the duration
              // animating something already invisible. See the note on
              // `EASE_IN`; it was measured, not guessed.
              exit={{
                opacity: 0,
                scale: 0.97,
                y: (position?.side ?? side) === 'top' ? 4 : -4,
                transition: { duration: DURATION.base, ease: EASE_IN },
              }}
              transition={SPRING_SNAPPY}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                maxWidth: position && maxWidth ? `min(${maxWidth}, ${position.maxWidth}px)` : position?.maxWidth ?? maxWidth,
                maxHeight: position && maxHeight ? `min(${maxHeight}, ${position.maxHeight}px)` : position?.maxHeight,
                minWidth: position && position.maxWidth < 192 ? 0 : undefined,
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
                'studio-floating-surface studio-blur fixed z-50 min-w-48 rounded-lg border p-1',
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
    </Anchor>
  )
}
