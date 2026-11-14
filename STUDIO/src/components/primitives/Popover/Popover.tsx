import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { floatingMotion } from '@/design/tokens'
import { cn } from '@/lib/cn'
import { floatingViewport, observeFloating, placeFloating, type FloatingAlign, type FloatingSide } from '@/design/layout/floating'
import { PresentMenuContent } from './MenuViews'

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
  anchorClassName,
  inline = false,
  companion,
  initialFocus,
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
  /** On the box around the trigger: a trigger that truncates needs that box to shrink. */
  anchorClassName?: string
  inline?: boolean
  companion?: { label: string; anchor: string; content: ReactNode } | null
  initialFocus?: string
}) {
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const companionPanel = useRef<HTMLDivElement>(null)
  const focusedInline = useRef(false)
  const returnFocus = useRef<string | null>(null)
  const [position, setPosition] = useState<(ReturnType<typeof placeFloating> & {
    companion: { left: number; top: number; overlays: boolean } | null
  }) | null>(null)
  const companionAnchor = companion?.anchor
  const companionOverlays = position?.companion?.overlays
  const companionOnLeft = position !== null && position.companion !== null && position.companion.left < position.left
  const companionTravel = companionOverlays ? 0 : companionOnLeft ? 6 : -6

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
    const viewport = floatingViewport()
    const placement = placeFloating({
      anchor: trigger,
      panel: { width: panelElement.offsetWidth, height: panelElement.offsetHeight },
      viewport, side, align, gap: offset,
    })
    const secondary = companionAnchor === undefined ? null : companionPanel.current
    if (secondary === null) {
      setPosition({ ...placement, companion: null })
      return
    }
    const right = placement.left + panelElement.offsetWidth + OFFSET
    const left = placement.left - secondary.offsetWidth - OFFSET
    const edge = viewport.left + viewport.edge
    const limit = viewport.left + viewport.width - viewport.edge
    const adjacent = right + secondary.offsetWidth <= limit ? right : left >= edge ? left : null
    const row = companionAnchor === undefined ? null : panelElement.querySelector(companionAnchor)
    const rowOffset = row === null ? 0 : row.getBoundingClientRect().top - panelElement.getBoundingClientRect().top
    const top = Math.min(
      adjacent === null ? placement.top : placement.top + rowOffset,
      viewport.top + viewport.height - viewport.edge - secondary.offsetHeight,
    )
    setPosition({
      ...placement,
      companion: {
        left: adjacent ?? placement.left,
        top: Math.max(viewport.top + viewport.edge, top),
        overlays: adjacent === null,
      },
    })
  }, [align, companionAnchor, offset, side])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()

    return observeFloating(
      anchor.current, panel.current, place, companionAnchor === undefined ? null : companionPanel.current,
    )
  }, [companionAnchor, open, place])

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
      if (anchor.current?.contains(target) || panel.current?.contains(target) || companionPanel.current?.contains(target)) return
      onOpenChange(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        const focused = document.activeElement
        const search = focused?.matches('[type="search"]') === true
        if ((inline || initialFocus !== undefined) && (search || focused instanceof HTMLButtonElement)) {
          const surface = companionPanel.current?.contains(focused) ? companionPanel.current : panel.current
          if (surface?.contains(focused)) {
            const items = [...surface.querySelectorAll<HTMLButtonElement>(
              'button:is([role="menuitem"], [role="menuitemradio"], [data-companion-focus]):not(:disabled)',
            )].filter((item) => item.closest('[inert]') === null)
            const index = items.findIndex((item) => item === focused)
            const next = event.key === 'ArrowDown' ? (index + 1) % items.length
              : event.key === 'ArrowUp' ? (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length)
              : !search && event.key === 'Home' ? 0
              : !search && event.key === 'End' ? items.length - 1 : null
            if (next !== null && items[next] !== undefined) {
              event.preventDefault()
              items[next].focus()
            }
          }
        }
        return
      }
      event.stopPropagation()
      onOpenChange(false)
      if (inline || initialFocus !== undefined) {
        anchor.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onOpenChange, inline, initialFocus])

  useEffect(() => {
    if (!open) { focusedInline.current = false; return }
    // A panel cannot accept focus until its measured position makes it visible.
    if ((!inline && initialFocus === undefined) || position === null || focusedInline.current) return
    const surface = panel.current
    const item = surface?.querySelector<HTMLElement>(initialFocus ?? '[role="menuitem"]')
    if (!surface || !item) return
    const focus = () => {
      item.focus()
      focusedInline.current = document.activeElement === item
      return focusedInline.current
    }
    if (focus()) return
    // The motion surface may still be hidden when React settles its position.
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect()
    })
    observer.observe(surface, { attributes: true, attributeFilter: ['class', 'style', 'inert'] })
    return () => observer.disconnect()
  }, [open, inline, initialFocus, position])

  useEffect(() => {
    if (!open) {
      returnFocus.current = null
    } else if (companionAnchor !== undefined && companionOverlays !== undefined) {
      returnFocus.current = companionAnchor
      companionPanel.current?.querySelector<HTMLElement>('[data-companion-focus]')?.focus()
    } else if (companionAnchor === undefined && returnFocus.current !== null) {
      if (companionPanel.current?.contains(document.activeElement)) {
        panel.current?.querySelector<HTMLElement>(returnFocus.current)?.focus()
      }
      returnFocus.current = null
    }
  }, [open, companionAnchor, companionOverlays])

  // An inline anchor stays plain inline. As `inline-flex` it made every prose
  // link a flex box: a long link could no longer wrap across lines, and a
  // citation pill inside it was blockified and pushed its line apart. The
  // panel is portaled and placed from the anchor's rect, so it needs nothing
  // from the anchor's display.
  const Anchor = inline ? 'span' : 'div'
  return (
    <Anchor ref={(element) => { anchor.current = element }} className={cn(inline ? 'relative' : 'relative inline-flex', anchorClassName)}>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panel}
              role="menu"
              inert={companionAnchor !== undefined && companionOverlays === true}
              {...floatingMotion(0, (position?.side ?? side) === 'top' ? 6 : -6)}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                maxWidth: position && maxWidth ? `min(${maxWidth}, ${position.maxWidth}px)` : position?.maxWidth ?? maxWidth,
                maxHeight: position && maxHeight ? `min(${maxHeight}, ${position.maxHeight}px)` : position?.maxHeight,
                minWidth: position && position.maxWidth < 192 ? 0 : undefined,
                // Grows out of the corner nearest its trigger, not the panel's middle.
                transformOrigin: `${(position?.side ?? side) === 'top' ? 'bottom' : 'top'} ${align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'}`,
                // Hidden until measured. The panel has to be in the DOM to have
                // a height worth measuring, so it renders first and is placed
                // immediately after — one frame in which it must not be seen.
                visibility: position && !(companionAnchor !== undefined && companionOverlays) ? 'visible' : 'hidden',
              }}
              className={cn(
                // `lg` panel with 4px padding puts rows on `sm` — the
                // concentric rule, so the row corners run parallel to the
                // panel's. The max-width is the same hard clamp the placement
                // math applies, said in CSS as well, so a panel can never be
                // the thing that gives the page a horizontal scrollbar.
                'studio-floating-surface studio-blur fixed z-50 min-w-48 rounded-xl border p-1.5',
                'shadow-overlay',
                className,
              )}
            >
              <PresentMenuContent>{children}</PresentMenuContent>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
      {createPortal(
        <AnimatePresence>
          {open && companion ? (
            <motion.div
              ref={companionPanel}
              role="menu"
              aria-label={companion.label}
              {...floatingMotion(companionTravel)}
              style={{
                left: position?.companion?.left ?? 0,
                top: position?.companion?.top ?? 0,
                maxWidth: position?.maxWidth,
                maxHeight: position?.maxHeight,
                transformOrigin: companionOverlays ? 'top center' : companionOnLeft ? 'top right' : 'top left',
                visibility: position?.companion ? 'visible' : 'hidden',
              }}
              className={cn(
                'studio-floating-surface studio-blur studio-scroll-menu fixed z-50 w-64 rounded-xl border p-1.5 shadow-overlay',
                'max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain',
              )}
            >
              <PresentMenuContent>{companion.content}</PresentMenuContent>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </Anchor>
  )
}
