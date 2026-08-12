import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SHELL } from '@/app/shell/shellConfig'
import { cn } from '@/lib/utils'

/**
 * The drag handle between a rail and the centre surface.
 *
 * Three details do most of the work here, and all three are the difference
 * between a handle that feels native and one that feels like a web page:
 *
 *   1. **The hit target is wider than anything visible.** Nothing is drawn at
 *      rest; the target is a 10px strip floating in the tray gutter. Fitts's
 *      law says a thin target is genuinely hard to hit, and every Mac app
 *      quietly cheats this the same way.
 *   2. **Pointer capture, not window listeners.** `setPointerCapture` keeps
 *      events coming to this element even when the pointer outrun the drag —
 *      over an iframe, past the window edge, anywhere. Without it a fast drag
 *      "sticks" because the pointer left the element mid-gesture.
 *   3. **It snaps.** Within 16px of the designed width the handle pulls to it,
 *      so a rail nudged out of true can be put back without aiming. The snap
 *      is silent; there is no marker to hunt for.
 *
 * Double-click resets to the designed width — the same gesture as an AppKit
 * split view.
 */
export function ResizeHandle({
  side,
  width,
  defaultWidth,
  onResize,
  onReset,
  label,
}: {
  /** Which rail this handle belongs to. Decides the sign of the drag delta. */
  side: 'left' | 'right'
  width: number
  defaultWidth: number
  onResize: (width: number) => void
  onReset: () => void
  label: string
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ x: 0, width: 0 })

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Only the primary button starts a drag; a right-click here should do
      // nothing rather than capture the pointer and wedge the cursor.
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      origin.current = { x: event.clientX, width }
      setDragging(true)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      // The right rail grows as the pointer travels left, so its delta is
      // inverted. Everything downstream is side-agnostic.
      const delta = event.clientX - origin.current.x
      const raw = origin.current.width + (side === 'left' ? delta : -delta)
      const snapped = Math.abs(raw - defaultWidth) < 16 ? defaultWidth : raw
      onResize(Math.round(snapped))
    },
    [dragging, side, defaultWidth, onResize],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      // Keyboard resize, for the same reason the handle has a role at all: a
      // split view that can only be driven by a pointer is a split view half
      // the users cannot move.
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8
        if (event.key === 'ArrowLeft') onResize(width + (side === 'left' ? -step : step))
        else if (event.key === 'ArrowRight') onResize(width + (side === 'left' ? step : -step))
        else if (event.key === 'Enter') onReset()
        else return
        event.preventDefault()
      }}
      /*
        Zero-width in the flex flow, with a negative margin cancelling the tray
        gutter it would otherwise add. The grabbable strip is the absolutely
        positioned child below, floating in the gap *between* two panels — so
        the handle costs no layout space and the panels stay exactly
        `panelGap` apart whether it is there or not.
      */
      className="group relative z-20 w-0 shrink-0 outline-none"
      style={{ marginInlineStart: -SHELL.panelGap }}
    >
      <span
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 cursor-col-resize touch-none"
        style={{ width: SHELL.resizeHandle.hitWidth }}
      >
        {/*
          Nothing is drawn at rest — the tray gutter is already the visual
          separation, and a permanent divider line down it would undo the
          floating-panel look. A soft pill fades in under the pointer so the
          handle is discoverable without being furniture.
        */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-4 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-opacity duration-150',
            dragging
              ? 'bg-foreground/35 opacity-100'
              : 'bg-foreground/25 opacity-0 group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100',
          )}
        />
      </span>
    </div>
  )
}
