import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { FADE, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, PageTransition } from '@/components/primitives'
import { ActivityBody, ActivityList, activityRows, viewTitle } from './Activity'
import { OVERVIEW_MAX_WIDTH, OVERVIEW_MIN_WIDTH, useOverview } from '@/stores/overview'

/**
 * The narrowest the conversation may become.
 *
 * Below this the top strip's centred identity line — project, title, branch —
 * runs out of room before its own truncation can save it, and the composer's
 * controls start colliding. It is a floor for the page, expressed as the rail's
 * ceiling.
 */
const MIN_PAGE_WIDTH = SHELL.minPageWidth

/** What the header calls the active entry, per kind. */


/**
 * The right-hand Overview, docked beside chat and the central Workspace when
 * there is room (`docked` in the Overview store): the activity list, and one thing from
 * it at a time. Without the room there is no column; the chat page draws the
 * same list from a pill over the composer and opens a thing in its sheet.
 *
 * The header shares the conversation strip's geometry; its title and close
 * control belong to the same row, even though the contents are independent.
 */
export function OverviewPanel({
  open,
  onClosed,
  minPageWidth = MIN_PAGE_WIDTH,
}: {
  /**
   * Whether the rail is on screen. Handed in by the shell rather than read
   * from the store, for the same reason the sidebar's is: while the sidebar
   * is on its way out the store already says open and the rail waits, so
   * the two moves happen in order (`panelHandover`).
   */
  open: boolean
  /** The rail has finished leaving. What releases a sidebar waiting on it. */
  onClosed?: () => void
  /** Chat and an open document need room beside the activity column. */
  minPageWidth?: number
}) {
  const { activity, browser, view, width, setWidth, closeAll, overview, show, conversationId } = useOverview()
  const reducedMotion = useReducedMotion()
  const frame = useRef<HTMLElement>(null)
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)
  const rows = activityRows(activity, browser)

  /**
   * The rail may not starve the page.
   *
   * Dragging it wide enough squeezed the conversation until the top strip broke
   * — the project, the title and the branch are one centred line, and there is
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

  const ceiling = Math.max(OVERVIEW_MIN_WIDTH, room - minPageWidth)
  const effective = Math.min(width, ceiling, room)

  return (
    <AnimatePresence initial={false} onExitComplete={onClosed}>
      {open ? (
        <motion.aside
          aria-label="Conversation overview"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (view !== null) overview()
            else closeAll()
          }}
          // Width animates, and nothing else. Sliding the rail in from off
          // screen would push the conversation sideways for the length of the
          // animation, and the conversation is what the reader is looking at.
          //
          // Each half rides its own vocabulary: the width is a resize the
          // person caused, so it takes the panel spring; the opacity is a
          // thing appearing, so it takes the house fade. One spring pacing
          // both made the fade mushy at the end - the spring's long settle
          // dragging a fade that should have been over. The same two
          // transitions serve enter and exit, so collapse and expand are one
          // motion played backwards, not two.
          ref={frame}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: effective, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={reducedMotion ? { duration: 0 } : { width: SPRING_PANEL, opacity: FADE.transition }}
          // Square, flush, and sunken — the mirror of the sidebar, for the
          // reason spelled out in `AppShell`: the radius belongs to the centre,
          // not to the column beside it.
          //
          // This was `my-2 mr-2 border` with its own `RADIUS.xl`, which made it
          // a rounded card floating in a gutter while the left column was the
          // ground the page rests on. Two columns either side of the same page,
          // built on opposite principles — and the page was already rounding
          // its right corners against this edge (`railOpen` in `AppShell`), so
          // there were two arcs a few pixels apart curving away from each
          // other. That gap is what read as "the rail became a rounded object".
          //
          // No hairline, same as the docked sidebar: the page's corner cuts a
          // notch through this edge, and a border would draw a straight rule
          // across the arc. The sunken surface is the seam.
          className="relative flex shrink-0 flex-col overflow-hidden bg-surface-sunken text-foreground"
        >
          <ResizeHandle width={effective} ceiling={ceiling} onWidth={setWidth} />

          {/* The contents keep the rail's full width while the frame moves.
              Without this they took the frame's width as it collapsed, and a
              column of prose reflowed into a narrower and narrower measure
              for the length of the exit - the "squish" before the rail was
              gone - while on the way in it unfolded from a sliver. Fixed to
              the width the rail is, the frame's edge clips them instead, the
              way the sidebar's inner column has always been sized. */}
          <div className="flex h-full min-h-0 shrink-0 flex-col" style={{ width: effective }}>
            <header className="flex shrink-0 items-center gap-1" style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}>
              {view !== null ? <IconButton label="Back to Overview" size="header" onClick={overview}><Icons.back size="header" /></IconButton> : null}
              <h2 className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                {view === null ? 'Overview' : viewTitle(view, activity, browser)}
              </h2>

              <IconButton label="Collapse Overview" size="header" onClick={closeAll}>
                <Icons.close size="header" />
              </IconButton>
            </header>


            <div className="relative min-h-0 flex-1">
              <PageTransition
                view={view === null ? 'overview' : view.kind === 'agent' ? `agent:${view.agentId}` : view.kind}
                className="studio-scroll-inset overflow-y-auto px-3 pb-4"
              >
                {view !== null && conversationId !== null
                  ? <ActivityBody view={view} conversationId={conversationId} />
                  : <ActivityList rows={rows} onPick={show} />}
              </PageTransition>
            </div>
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
 * window loses focus mid-drag — the case that leaves a document listener
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
  // handle — otherwise it flickers back to an arrow the moment the pointer
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
      aria-label="Resize Overview"
      aria-valuenow={width}
      aria-valuemin={OVERVIEW_MIN_WIDTH}
      aria-valuemax={Math.min(OVERVIEW_MAX_WIDTH, ceiling)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { start.current = null }}
      onLostPointerCapture={() => { start.current = null }}
      onKeyDown={(event) => {
        // Keyboard resize, because a drag handle that only answers to a mouse
        // is a control some people simply cannot use.
        if (event.key === 'ArrowLeft') { event.preventDefault(); onWidth(Math.min(ceiling, width + 24)) }
        if (event.key === 'ArrowRight') { event.preventDefault(); onWidth(width - 24) }
      }}
      className="group/resize absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none"
    >
      {/* A grip at the middle of the edge, not a rule down the whole of it.
          The reach stays full height — you can still grab the seam anywhere
          along it — but the *mark* is a short centred line, because a hairline
          running floor to ceiling is a wall between two panels rather than a
          handle on one. It also duplicated the seam the sunken surface already
          draws, so the edge carried two lines saying the same thing.

          One control step tall, so the grip matches the buttons it sits near
          instead of being a length chosen by eye. Faint at rest, where it only
          has to say "this can be pulled", and firmer once the pointer arrives
          or the handle takes focus. */}
      <span className="absolute top-1/2 left-1/2 h-[var(--control-lg)] w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20 transition-colors duration-fast group-hover/resize:bg-foreground/45 group-active/resize:bg-foreground/45 group-focus-visible/resize:bg-foreground/45" />
    </div>
  )
}
