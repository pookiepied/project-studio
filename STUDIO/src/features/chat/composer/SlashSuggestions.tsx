import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SNAPPY } from '@/design/tokens'
import { Icons } from '@/components/icons'
import type { CommandRecord } from '@/platform/harness'
import { cn } from '@/lib/cn'

/** Breathing room between the panel and the composer's top edge, and from the window's. */
const GAP = 6
const MARGIN = 8

/**
 * The commands a slash offers, floating above the composer.
 *
 * ---- Why it is not part of the composer's frame ----------------------------
 *
 * It used to render in the flow, above the field but inside the frame: the
 * picker's arrival made the composer grow upward, and the rows sat on the
 * same raised surface as the words, under the same radius — one box wearing
 * two jobs. The field is the message; the picker is a menu the message
 * opened. A menu that shares its host's surface reads as part of the input,
 * which is exactly what a person meant by "the commands show up inside the
 * text field". So the panel is a portal to `document.body`, the way every
 * popover in the app is: nothing can clip it, nothing above the composer
 * has to move for it, and its own shadow and hairline say "separate
 * object" the way the elevation scale says it everywhere else.
 *
 * ---- The shape -------------------------------------------------------------
 *
 * Anchored to the composer's frame (`anchor`, the ref the composer keeps on
 * its own root) and exactly as wide as it, so the panel reads as the
 * composer opening upward rather than a card parked over the transcript.
 * Measured and pinned `fixed`, like `Popover`; re-placed on scroll, resize
 * and on the panel's own size changing, because the list shrinks as a name
 * is typed.
 *
 * ---- The motion ------------------------------------------------------------
 *
 * The house popover entrance, told from below: the panel rises out of the
 * composer's top edge — scale 0.97 to 1, a few pixels of travel, the snappy
 * spring — and leaves by retracing it on the ease-in, the same pair every
 * menu in the app uses. It is driven entirely by the field: up and down to
 * move, Enter or Tab to take, Escape to dismiss — the hands never leave the
 * words.
 *
 * A list, not a menu: each row is the mark for the command's kind, the name
 * in the field's own monospace, the hint for what follows it, and the one
 * line that says what it does. The picked row is marked the way a menu marks
 * its selection — the chip, and nothing else.
 */
export function SlashSuggestions({
  anchor,
  commands,
  selected,
  onPick,
  onHover,
}: {
  /** The composer's own root element, which the panel opens above. */
  anchor: React.RefObject<HTMLDivElement | null>
  /** The rows to offer, or null while no slash is being typed. */
  commands: readonly CommandRecord[] | null
  selected: number
  onPick: (command: CommandRecord) => void
  onHover: (index: number) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const open = commands !== null

  // The picked row stays in view as the arrows move it past the edge.
  useEffect(() => {
    const element = list.current?.children[selected]
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
  }, [selected])

  /**
   * Places the panel against the viewport, exactly as `Popover` places its
   * own: layout sizes (`offsetHeight`), not the transformed rect; hidden
   * until the first placement has run, so the panel is never seen at the
   * wrong coordinates. The width is written directly rather than through
   * React, because the height that the placement depends on is measured at
   * that width — a width arriving a render later would place the panel one
   * row short on the first open.
   */
  const place = useCallback(() => {
    const frame = anchor.current?.getBoundingClientRect()
    const element = panel.current
    if (!frame || !element) return

    const width = Math.min(frame.width, window.innerWidth - MARGIN * 2)
    element.style.width = `${width}px`
    const height = element.offsetHeight

    const top = Math.min(
      Math.max(frame.top - height - GAP, MARGIN),
      Math.max(MARGIN, window.innerHeight - height - MARGIN),
    )
    const left = Math.min(
      Math.max(frame.left, MARGIN),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    )
    setPosition((current) =>
      current !== null && current.top === top && current.left === left ? current : { top, left },
    )
  }, [anchor])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()

    // The transcript scrolls under the open panel, and the window can be
    // resized; a fixed panel follows neither on its own. `capture` catches
    // scrolls on any ancestor, including the panel's own list — the same
    // wiring `Popover` runs, and for the same reasons.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => place())
    if (panel.current !== null && observer !== undefined) observer.observe(panel.current)

    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [open, place])

  // Always mounted, so the panel's leaving is an exit the AnimatePresence
  // below can play rather than an unmount nobody sees.
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panel}
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{
            opacity: 0,
            scale: 0.97,
            y: 8,
            transition: { duration: DURATION.base, ease: EASE_IN },
          }}
          transition={SPRING_SNAPPY}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            transformOrigin: 'bottom center',
            // Hidden until measured — the panel has to be in the DOM to have
            // a height worth placing against, and that first frame must not
            // be seen at (0, 0).
            visibility: position ? 'visible' : 'hidden',
          }}
          className={cn(
            // The popover recipe: translucent, blurred, one hairline, the
            // overlay step of the shadow scale. `p-1` puts rows on `sm`,
            // the concentric rule.
            'studio-blur fixed z-50 rounded-lg border p-1 shadow-overlay',
          )}
        >
          {commands.length === 0 ? (
            <div className="px-2 py-1.5 text-caption text-muted-foreground" role="note">
              No command by that name. Sent as written.
            </div>
          ) : (
            <ul
              ref={list}
              role="listbox"
              aria-label="Commands"
              className="studio-scroll-bounded max-h-64 overflow-y-auto"
            >
              {commands.map((command, index) => (
                <li
                  key={command.id}
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(event) => {
                    // Before the field loses focus to the click, so the words
                    // land in a field that still has the caret.
                    event.preventDefault()
                    onPick(command)
                  }}
                  className={cn(
                    'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5',
                    index === selected ? 'bg-selected' : '',
                  )}
                >
                  <span className="flex h-[1lh] w-[1.1em] shrink-0 items-center justify-center">
                    {command.kind === 'action' ? <Icons.compaction /> : <Icons.command />}
                  </span>
                  <span className="shrink-0 font-mono text-ui text-foreground">/{command.id}</span>
                  {command.argumentHint !== '' ? (
                    <span className="shrink-0 font-mono text-caption text-muted-foreground/80">
                      {command.argumentHint}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                    {command.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
