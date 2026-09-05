import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FADE, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { renderArtifact } from '@/features/artifacts'
import { PlanPanel } from '@/features/plans/PlanPanel'
import { RailTabs } from '@/features/rail/RailTabs'
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, useRail, type RailEntry } from '@/stores/rail'
import { cn } from '@/lib/cn'

/**
 * The narrowest the conversation may become.
 *
 * Below this the top strip's centred identity line — project, title, branch —
 * runs out of room before its own truncation can save it, and the composer's
 * controls start colliding. It is a floor for the page, expressed as the rail's
 * ceiling.
 */
const MIN_PAGE_WIDTH = 520

/** What the header calls the active entry, per kind. */
function entryTitle(entry: RailEntry): string {
  return entry.kind === 'artifact' ? entry.artifact.title : 'Plan'
}


/**
 * The side rail.
 *
 * A column beside the conversation holding artifacts opened out of it. The
 * transcript is a reading measure — deliberately narrow — and some things the
 * model produces are simply the wrong shape for it: a table with fifteen
 * columns, a long list of sources, an image worth looking at. Rather than
 * widen the column for everyone, those move here.
 *
 * ---- The two placements ---------------------------------------------------
 *
 * `inset` floats the rail as its own rounded panel with the window's ground
 * visible above and below, which is the same language the page uses — a panel
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
          transition={{ width: SPRING_PANEL, opacity: FADE.transition }}
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
          className="relative flex shrink-0 flex-col overflow-hidden bg-surface-sunken"
        >
          <ResizeHandle width={effective} ceiling={ceiling} onWidth={setWidth} />

          <header className="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
              {active === undefined ? 'Side rail' : entryTitle(active)}
            </span>

            <IconButton label="Close the rail" size="sm" onClick={closeAll}>
              <Icons.close size="sm" />
            </IconButton>
          </header>

          <RailTabs />

          {/* Keyed by the entry, so switching plays the view transition rather
              than swapping content inside a frame that never acknowledges it
              changed.

              `popLayout` is what makes that claim true: the outgoing view fades
              while the incoming one fades in, without either pushing the other
              down the scroll. Without a mode at all both stay in the flow and
              the panel jumps; with `wait` the outgoing view vanishes first and
              the handover dips through empty - which is exactly what this block
              did for its first year, calling itself a crossfade. A pure
              crossfade, like every other lateral move between same-depth views:
              this one used to add a small rise, the vertical motion that makes a
              horizontal handover look like a fault.

              The scroll body is `relative` so the popped-out view overlays it
              rather than the whole rail. */}
          <div className="studio-scroll-inset relative min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <AnimatePresence initial={false} mode="popLayout">
              {active !== undefined ? (
                <motion.div {...FADE} className={cn('min-w-0', active.kind === 'artifact' && 'studio-prose')}>
                  {active.kind === 'artifact' ? (
                    renderArtifact(active.artifact)
                  ) : (
                    <PlanPanel conversationId={active.conversationId} />
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
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
