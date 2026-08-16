import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RADIUS, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { renderArtifact } from '@/features/artifacts'
import { RailTabs } from '@/features/rail/RailTabs'
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, useRail } from '@/stores/rail'

/**
 * The narrowest the conversation may become.
 *
 * Below this the top strip's centred identity line -- project, title, branch --
 * runs out of room before its own truncation can save it, and the composer's
 * controls start colliding. It is a floor for the page, expressed as the rail's
 * ceiling.
 */
const MIN_PAGE_WIDTH = 520


/**
 * The side rail.
 *
 * A column beside the conversation holding artifacts opened out of it. The
 * transcript is a reading measure -- deliberately narrow -- and some things the
 * model produces are simply the wrong shape for it: a table with fifteen
 * columns, a long list of sources, an image worth looking at. Rather than
 * widen the column for everyone, those move here.
 *
 * ---- The two placements ---------------------------------------------------
 *
 * `inset` floats the rail as its own rounded panel with the window's ground
 * visible above and below, which is the same language the page uses -- a panel
 * resting on the sidebar rather than a region of one sheet. It is the default
 * because it keeps the window reading as a set of objects.
 *
 * `full` runs flush from top to bottom. It gives back the vertical margins and
 * squares the corners against the window edge, which is what you want when the
 * thing being read is long enough that the margins are just lost lines.
 *
 * The toggle is in the header rather than in settings: which one is right
 * depends on what is open right now, not on a preference held across sessions.
 */
export function SideRail() {
  const { open, entries, activeId, width, setWidth, closeAll } = useRail()
  const frame = useRef<HTMLElement>(null)
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)

  const active = entries.find((entry) => entry.id === activeId) ?? entries[entries.length - 1]

  /**
   * The rail may not starve the page.
   *
   * Dragging it wide enough squeezed the conversation until the top strip broke
   * -- the project, the title and the branch are one centred line, and there is
   * a width below which they simply cannot all be there. The honest fix is to
   * refuse the drag rather than to let the layout fail: the page keeps a floor,
   * and the rail's ceiling is whatever is left over.
   *
   * Measured from the shell rather than the window, because the sidebar may or
   * may not be taking space from it, and the answer differs.
   */
  useEffect(() => {
    const shell = frame.current?.parentElement
    if (!shell) return

    const measure = () => setRoom(shell.clientWidth)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [open])

  const ceiling = Math.max(RAIL_MIN_WIDTH, room - MIN_PAGE_WIDTH)
  const effective = Math.min(width, ceiling)

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          aria-label="Side rail"
          // Width animates, and nothing else. Sliding the rail in from off
          // screen would push the conversation sideways for the length of the
          // animation, and the conversation is what the reader is looking at.
          ref={frame}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: effective, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={SPRING_PANEL}
          className="relative my-2 mr-2 flex shrink-0 flex-col overflow-hidden border bg-surface"
          style={{ borderRadius: RADIUS.xl }}
        >
          <ResizeHandle width={effective} ceiling={ceiling} onWidth={setWidth} />

          <header className="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
              {active?.artifact.title ?? 'Side rail'}
            </span>

            <IconButton label="Close the rail" size="sm" onClick={closeAll}>
              <Icons.close />
            </IconButton>
          </header>

          <RailTabs />

          {/* Keyed by the entry, so switching plays the view transition rather
              than swapping content inside a frame that never acknowledges it
              changed. */}
          <div className="studio-scroll-inset min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {active ? (
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="studio-prose min-w-0"
              >
                {renderArtifact(active.artifact)}
              </motion.div>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * The drag edge.
 *
 * Four pixels wide with a wider invisible reach, because a 1px border is a
 * target nobody hits on the first try. Pointer capture rather than
 * document-level listeners: capture keeps the drag alive when the pointer
 * outruns the handle, which it always does, and it releases cleanly if the
 * window loses focus mid-drag -- the case that leaves a document listener
 * attached forever.
 */
function ResizeHandle({
  width,
  ceiling,
  onWidth,
}: {
  width: number
  ceiling: number
  onWidth: (width: number) => void
}) {
  const start = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, width }
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!start.current) return
      // Dragging left widens: the rail is on the right, so its edge moves
      // against the pointer's direction of travel.
      onWidth(Math.min(ceiling, start.current.width + (start.current.x - event.clientX)))
    },
    [ceiling, onWidth],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    start.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  // The cursor belongs to the whole document while dragging, not just to the
  // handle -- otherwise it flickers back to an arrow the moment the pointer
  // leaves the 4px strip, which is immediately.
  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
    }
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the rail"
      aria-valuenow={width}
      aria-valuemin={RAIL_MIN_WIDTH}
      aria-valuemax={Math.min(RAIL_MAX_WIDTH, ceiling)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(event) => {
        // Keyboard resize, because a drag handle that only answers to a mouse
        // is a control some people simply cannot use.
        if (event.key === 'ArrowLeft') onWidth(Math.min(ceiling, width + 24))
        if (event.key === 'ArrowRight') onWidth(width - 24)
      }}
      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none after:absolute after:inset-y-0 after:-left-1 after:w-3 hover:bg-selected focus-visible:bg-selected"
    />
  )
}
