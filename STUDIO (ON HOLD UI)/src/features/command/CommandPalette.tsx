import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SURFACE } from '@/app/motion'
import { useChrome } from '@/app/shell/ChromeProvider'
import { useMountTransition } from '@/app/useMountTransition'
import { Search } from '@/components/icons'
import { GROUP_ORDER, rankCommands, type Command, type CommandGroup } from '@/features/command/commands'
import { useCommands } from '@/features/command/useCommands'
import { cn } from '@/lib/utils'

/**
 * ⌘K — one place to reach anything.
 *
 * The palette is the answer to a problem the sidebar could not solve: with the
 * navigator closed, or with more projects than fit in it, there was no way to
 * get somewhere without first getting somewhere else. Spotlight, Raycast,
 * Linear and VS Code all converged on the same shape, and the shape is the
 * point — a centred field near the top of the window, results grouped
 * underneath, arrow keys and Enter.
 *
 * Two behaviours matter more than they look:
 *
 *   - **The selection resets on every keystroke.** Keeping the highlight on
 *     row 4 while the list underneath changes means Enter runs whatever
 *     happens to be there now. That is the classic palette bug.
 *   - **Hover moves the selection.** Otherwise the keyboard highlight and the
 *     pointer disagree about what is selected, and Enter surprises you.
 */

/** Leave duration, in ms. Must match the transition below. */
const EXIT_MS = DURATION.base * 1000
export function CommandPalette() {
  const { commandOpen, setCommandOpen } = useChrome()

  /*
    Mounted only while open. The palette reads every project and conversation
    to build its list; there is no reason to keep that subscription live for a
    surface nobody is looking at.

    The lifecycle is `useMountTransition`, not `AnimatePresence` — see that
    file for why. Short version: conditional presence never completes on this
    framer-motion/React pairing, and a palette stuck at `opacity: 0` is a
    full-window sheet that eats every click in the app.
  */
  const mounted = useMountTransition(commandOpen, EXIT_MS)
  if (!mounted) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: commandOpen ? 1 : 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[14vh]"
    >
      <PaletteSurface open={commandOpen} onClose={() => setCommandOpen(false)} />
    </motion.div>
  )
}

function PaletteSurface({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => onClose(), [onClose])
  const commands = useCommands(close)
  const results = useMemo(() => rankCommands(commands, query), [commands, query])

  // Any change to the result set invalidates the highlight's position.
  useEffect(() => setSelected(0), [query])

  const move = useCallback(
    (delta: number) => {
      setSelected((current) => {
        if (results.length === 0) return 0
        // Wrapping, because a palette list is short and hitting the end of it
        // should not feel like hitting a wall.
        return (current + delta + results.length) % results.length
      })
    },
    [results.length],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Enter') results[selected]?.run()
    else if (event.key === 'Escape') close()
    else return
    event.preventDefault()
  }

  // Keep the highlighted row in view when the keyboard, not the pointer, is
  // driving. `nearest` rather than `center` so a short list does not jump.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, Array<{ command: Command; index: number }>>()
    results.forEach((command, index) => {
      const bucket = map.get(command.group) ?? []
      bucket.push({ command, index })
      map.set(command.group, bucket)
    })
    return GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({
      group,
      entries: map.get(group)!,
    }))
  }, [results])

  return (
    <>
      <div
        onClick={close}
        className="studio-blur-scrim absolute inset-0 bg-scrim"
        aria-hidden
      />

      {/* Driven by `open`, not by presence — the parent stays mounted through
          the leave animation and then drops it. */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={
          open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -6, scale: 0.985 }
        }
        transition={open ? SPRING_SURFACE : { duration: DURATION.base, ease: EASE_OUT }}
        onKeyDown={onKeyDown}
        className="studio-blur relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3.5">
          <Search size="sm" className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects, conversations and commands…"
            aria-label="Search"
            aria-controls="command-results"
            aria-activedescendant={results[selected] ? `command-${results[selected].id}` : undefined}
            className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-xs border border-border px-1 font-sans text-[10px] leading-[15px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(52vh,420px)] min-h-0 overflow-y-auto p-1.5"
        >
          {grouped.map(({ group, entries }) => (
            <div key={group} className="mb-1 last:mb-0">
              <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                {group}
              </p>
              {entries.map(({ command, index }) => (
                <CommandRow
                  key={command.id}
                  command={command}
                  selected={index === selected}
                  onHover={() => setSelected(index)}
                />
              ))}
            </div>
          ))}

          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
        </div>

        <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
          <Hint keys="↑↓" label="Navigate" />
          <Hint keys="↵" label="Open" />
          <Hint keys="esc" label="Dismiss" />
        </div>
      </motion.div>
    </>
  )
}

function CommandRow({
  command,
  selected,
  onHover,
}: {
  command: Command
  selected: boolean
  onHover: () => void
}) {
  const Glyph = command.icon

  return (
    <button
      type="button"
      id={`command-${command.id}`}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      onMouseMove={onHover}
      onClick={command.run}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100',
        selected ? 'bg-muted' : 'bg-transparent',
      )}
    >
      <Glyph
        size="sm"
        className={cn('shrink-0', selected ? 'text-foreground' : 'text-muted-foreground')}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">{command.label}</span>
        {command.detail && (
          <span className="block truncate text-[11px] text-muted-foreground">{command.detail}</span>
        )}
      </span>
    </button>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded-xs border border-border px-1 font-sans text-[10px] leading-[15px]">
        {keys}
      </kbd>
      {label}
    </span>
  )
}
