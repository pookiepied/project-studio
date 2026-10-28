import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import { inkPath, summarize, type InkPoint, type MonitorPlace } from '@/domain/screen/ink'
import type { Mark, MarkSet } from '@/domain/screen/marks'
import {
  finishScreenDrawing,
  onOverlayDraw,
  onOverlayMarks,
  onOverlayReset,
  overlayIdle,
  overlayState,
  sendDrawnShapes,
} from '@/platform/tauri/screenOverlay'
import { cn } from '@/lib/cn'

/**
 * Studio on the person's screen (ADR 0059): the agent's marks, and the
 * person's own ink while they show Studio something.
 *
 * ---- What this window is ------------------------------------------------------
 *
 * A transparent window over one whole display, built by `screen_overlay.rs`.
 * Most of the time it passes every click through and paints only the marks
 * the agent asked for, which fade by themselves. During "Show me" it takes
 * the pointer, a toolbar appears at the top of the display, and whatever the
 * person draws stays until they press Done and a few seconds after.
 *
 * ---- Colour --------------------------------------------------------------------
 *
 * The app's own chrome is monochrome; this is not chrome. It is drawn over
 * any picture at all, dark or light, so each mark carries a white halo under
 * a saturated line, and the two hands get two colours: blue for the agent,
 * pink for the person - so a picture with both in it says who drew what. The
 * toolbar is dark glass in either theme, like the system's own screenshot
 * bar, because it too sits on unknown content.
 *
 * ---- What leaves this window ---------------------------------------------------
 *
 * Each finished stroke, reduced to its shape and box in desktop pixels
 * (`domain/screen/ink.ts`). Never the points. The ink itself is left on
 * screen, so the next picture the agent takes shows it exactly.
 */

const AGENT = '#0A84FF'
const PERSON = '#FF375F'
const HIGHLIGHT = '#FFD60A'
/** How long the ink stays after Done, so the agent's next look still finds it. */
const INK_LINGER_MS = 8_000
/** Points closer than this, in CSS pixels, add nothing to a stroke but weight. */
const MIN_STEP = 1.5

type Tool = 'pen' | 'highlighter'

interface Stroke {
  readonly id: number
  readonly tool: Tool
  readonly points: readonly InkPoint[]
}

function toCss(monitor: MonitorPlace, set: MarkSet, x: number, y: number): InkPoint {
  return {
    x: (set.display.x + x - monitor.x) / monitor.scale,
    y: (set.display.y + y - monitor.y) / monitor.scale,
  }
}

export function ScreenOverlayWindow() {
  const [monitor, setMonitor] = useState<MonitorPlace | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [tool, setTool] = useState<Tool>('pen')
  const [strokes, setStrokes] = useState<readonly Stroke[]>([])
  const [live, setLive] = useState<readonly InkPoint[] | null>(null)
  const [sets, setSets] = useState<readonly MarkSet[]>([])
  const next = useRef(1)
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showMarks = useCallback((place: MonitorPlace, set: MarkSet | null) => {
    setMonitor((current) => current ?? place)
    if (set === null) { setSets([]); return }
    if (set.expiresAt <= Date.now()) return
    setMonitor(place)
    // One set at a time: a new answer replaces what the agent was pointing at.
    setSets([set])
  }, [])

  // State first, for a page that loaded after the events; then the events.
  useEffect(() => {
    let live = true
    const stops: (() => void)[] = []
    void overlayState().then((state) => {
      if (!live || state === null) return
      if (state.drawing !== null) { setMonitor(state.drawing.monitor); setDrawing(true) }
      if (state.marks !== null) showMarks(state.marks.monitor, state.marks.set)
    })
    void onOverlayMarks((marks) => showMarks(marks.monitor, marks.set)).then((stop) => { if (live) stops.push(stop); else stop() })
    void onOverlayDraw((place) => {
      if (linger.current !== null) clearTimeout(linger.current)
      setMonitor(place); setDrawing(true); setStrokes([]); setTool('pen')
    }).then((stop) => { if (live) stops.push(stop); else stop() })
    void onOverlayReset(() => {
      setDrawing(false); setStrokes([]); setSets([]); setLive(null)
    }).then((stop) => { if (live) stops.push(stop); else stop() })
    return () => { live = false; for (const stop of stops) stop() }
  }, [showMarks])

  // Each set leaves when it expires.
  useEffect(() => {
    if (sets.length === 0) return
    const soonest = Math.min(...sets.map((set) => set.expiresAt))
    const timer = setTimeout(() => setSets((current) => current.filter((set) => set.expiresAt > Date.now())), Math.max(0, soonest - Date.now()))
    return () => clearTimeout(timer)
  }, [sets])

  // Nothing left on screen: the native side hides the window. After the exit
  // animations, so the last mark fades rather than vanishing with its window.
  const empty = !drawing && strokes.length === 0 && sets.length === 0
  useEffect(() => {
    if (!empty) return
    const timer = setTimeout(() => void overlayIdle(), DURATION.slow * 1000 + 60)
    return () => clearTimeout(timer)
  }, [empty])

  useEffect(() => () => { if (linger.current !== null) clearTimeout(linger.current) }, [])

  const point = (event: ReactPointerEvent<SVGSVGElement>): InkPoint => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setLive([point(event)])
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (live === null) return
    const at = point(event)
    const last = live[live.length - 1]
    if (last !== undefined && Math.hypot(at.x - last.x, at.y - last.y) < MIN_STEP) return
    setLive([...live, at])
  }

  const onPointerUp = () => {
    if (live === null || monitor === null) return
    const stroke: Stroke = { id: next.current++, tool, points: live }
    setStrokes((current) => [...current, stroke])
    setLive(null)
    const shape = summarize(stroke.points, monitor)
    if (shape !== null) void sendDrawnShapes([shape])
  }

  const done = () => {
    setDrawing(false)
    setLive(null)
    void finishScreenDrawing()
    if (linger.current !== null) clearTimeout(linger.current)
    linger.current = setTimeout(() => setStrokes([]), INK_LINGER_MS)
  }

  if (monitor === null) return null
  const width = monitor.width / monitor.scale
  const height = monitor.height / monitor.scale

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-transparent">
      {/* A whisper of shade while drawing: enough to say the screen is
          listening to the pen, not enough to change what the picture shows. */}
      <AnimatePresence>
        {drawing ? (
          <motion.div
            key="veil"
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'rgba(0, 0, 0, 0.035)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          />
        ) : null}
      </AnimatePresence>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('absolute inset-0', drawing ? 'cursor-crosshair' : 'pointer-events-none')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <AnimatePresence>
          {strokes.map((stroke) => (
            <motion.g
              key={stroke.id}
              initial={false}
              exit={{ opacity: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } }}
            >
              <InkStroke tool={stroke.tool} points={stroke.points} />
            </motion.g>
          ))}
        </AnimatePresence>
        {live !== null ? <InkStroke tool={tool} points={live} /> : null}

        <AnimatePresence>
          {sets.flatMap((set) => set.marks.map((mark, index) => (
            <AgentMark key={`${set.id}-${index}`} mark={mark} at={(x, y) => toCss(monitor, set, x, y)} bounds={{ width, height }} />
          )))}
        </AnimatePresence>
      </svg>

      <AnimatePresence>
        {drawing ? (
          <DrawingToolbar
            key="toolbar"
            tool={tool}
            canUndo={strokes.length > 0}
            onTool={setTool}
            onUndo={() => setStrokes((current) => current.slice(0, -1))}
            onClear={() => setStrokes([])}
            onDone={done}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function InkStroke({ tool, points }: { tool: Tool; points: readonly InkPoint[] }) {
  const path = inkPath(points)
  if (tool === 'highlighter') {
    return <path d={path} fill="none" stroke={HIGHLIGHT} strokeOpacity={0.42} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" style={{ mixBlendMode: 'multiply' }} />
  }
  return (
    <>
      <path d={path} fill="none" stroke="white" strokeOpacity={0.85} strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke={PERSON} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

const DRAW_IN = { duration: DURATION.slow, ease: EASE_OUT }
const LEAVE = { opacity: 0, transition: { duration: DURATION.base, ease: EASE_OUT } }

/** One of the agent's marks: drawn in once, then still, then faded out. */
function AgentMark({
  mark,
  at,
  bounds,
}: {
  mark: Mark
  at: (x: number, y: number) => InkPoint
  bounds: { width: number; height: number }
}) {
  const origin = at(mark.x, mark.y)
  const halo = { fill: 'none', stroke: 'white', strokeOpacity: 0.9, strokeWidth: 7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const line = { fill: 'none', stroke: AGENT, strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  let body: React.ReactNode
  let labelAt: InkPoint = { x: origin.x + 16, y: origin.y + 16 }

  if (mark.kind === 'point') {
    body = (
      <>
        {/* A ripple, twice: enough to find the dot on a busy screen, then still. */}
        <motion.circle
          cx={origin.x} cy={origin.y} fill="none" stroke={AGENT} strokeWidth={2}
          initial={{ r: 8, opacity: 0.55 }}
          animate={{ r: 30, opacity: 0 }}
          transition={{ duration: 1.1, ease: EASE_OUT, repeat: 1 }}
        />
        <motion.circle
          cx={origin.x} cy={origin.y} r={7} fill={AGENT} stroke="white" strokeWidth={2.5}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRING_SNAPPY}
          style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
        />
      </>
    )
  } else if (mark.kind === 'ring' || mark.kind === 'box') {
    const far = at(mark.x + (mark.width ?? 0), mark.y + (mark.height ?? 0))
    const pad = 6
    const x = origin.x - pad
    const y = origin.y - pad
    const w = far.x - origin.x + pad * 2
    const h = far.y - origin.y + pad * 2
    labelAt = { x: x + w + 10, y }
    const shape = mark.kind === 'ring'
      ? `M${x + w / 2} ${y} a${w / 2} ${h / 2} 0 1 1 -0.01 0`
      : roundedRect(x, y, w, h, Math.min(10, w / 4, h / 4))
    body = (
      <>
        <motion.path d={shape} {...halo} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={DRAW_IN} />
        <motion.path d={shape} {...line} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={DRAW_IN} />
      </>
    )
  } else {
    const to = at(mark.toX ?? mark.x, mark.toY ?? mark.y)
    const angle = Math.atan2(to.y - origin.y, to.x - origin.x)
    const head = (spread: number) => `${to.x - 14 * Math.cos(angle - spread)} ${to.y - 14 * Math.sin(angle - spread)}`
    const shaft = `M${origin.x} ${origin.y} L${to.x} ${to.y}`
    const tip = `M${head(0.5)} L${to.x} ${to.y} L${head(-0.5)}`
    labelAt = { x: origin.x + 12, y: origin.y + 12 }
    body = (
      <>
        <motion.path d={shaft} {...halo} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={DRAW_IN} />
        <motion.path d={tip} {...halo} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...DRAW_IN, delay: DURATION.base }} />
        <motion.path d={shaft} {...line} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={DRAW_IN} />
        <motion.path d={tip} {...line} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...DRAW_IN, delay: DURATION.base }} />
      </>
    )
  }

  return (
    <motion.g initial={{ opacity: 1 }} exit={LEAVE}>
      {body}
      {mark.label === undefined ? null : <MarkLabel text={mark.label} at={labelAt} bounds={bounds} />}
    </motion.g>
  )
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h - r}a${r} ${r} 0 0 1 -${r} ${r}H${x + r}a${r} ${r} 0 0 1 -${r} -${r}V${y + r}a${r} ${r} 0 0 1 ${r} -${r}Z`
}

/** A few words beside a mark, kept inside the display. */
function MarkLabel({ text, at, bounds }: { text: string; at: InkPoint; bounds: { width: number; height: number } }) {
  const width = Math.min(260, 20 + text.length * 7)
  const x = Math.max(8, Math.min(bounds.width - width - 8, at.x))
  const y = Math.max(8, Math.min(bounds.height - 34, at.y))
  return (
    <motion.foreignObject
      x={x} y={y} width={width} height={28}
      initial={{ opacity: 0, y: y + 4 }}
      animate={{ opacity: 1, y }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: DURATION.fast }}
    >
      <div
        className="inline-flex h-7 max-w-full items-center truncate rounded-full px-3 text-[12px] font-medium text-white"
        style={{ background: 'rgba(28, 28, 30, 0.82)', backdropFilter: 'blur(20px) saturate(1.6)', boxShadow: '0 0 0 0.5px rgba(255,255,255,0.12), 0 6px 18px rgba(0,0,0,0.22)' }}
      >
        {text}
      </div>
    </motion.foreignObject>
  )
}

/**
 * The toolbar while the person draws: two pens, undo, clear, and Done. Dark
 * glass at the top centre of the display, in either theme - it sits on
 * whatever is on screen, so it borrows the system HUD's look rather than the
 * app's surfaces.
 */
function DrawingToolbar({
  tool,
  canUndo,
  onTool,
  onUndo,
  onClear,
  onDone,
}: {
  tool: Tool
  canUndo: boolean
  onTool: (tool: Tool) => void
  onUndo: () => void
  onClear: () => void
  onDone: () => void
}) {
  return (
    <motion.div
      role="toolbar"
      aria-label="Drawing"
      className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5 pl-3.5 text-white"
      style={{
        background: 'rgba(28, 28, 30, 0.78)',
        backdropFilter: 'blur(24px) saturate(1.7)',
        boxShadow: '0 0 0 0.5px rgba(255,255,255,0.14), inset 0 0.5px 0 rgba(255,255,255,0.10), 0 12px 32px rgba(0,0,0,0.28)',
      }}
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      <span className="mr-1.5 flex items-center gap-2 whitespace-nowrap text-[12px] text-white/70">
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: tool === 'pen' ? PERSON : HIGHLIGHT }} />
        Draw to show Studio
      </span>
      <ToolButton label="Pen" active={tool === 'pen'} onClick={() => onTool('pen')}><Icons.inkPen size="md" /></ToolButton>
      <ToolButton label="Highlighter" active={tool === 'highlighter'} onClick={() => onTool('highlighter')}><Icons.inkHighlighter size="md" /></ToolButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}><Icons.inkUndo size="md" /></ToolButton>
      <ToolButton label="Clear" disabled={!canUndo} onClick={onClear}><Icons.inkErase size="md" /></ToolButton>
      <button
        type="button"
        onClick={onDone}
        className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12px] font-medium text-[#1c1c1e] transition-colors duration-[120ms] hover:bg-white/90"
      >
        <Icons.inkDone size="sm" className="!text-[#1c1c1e]" />
        Done
      </button>
    </motion.div>
  )
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex size-8 items-center justify-center rounded-full transition-colors duration-[120ms]',
        '[&_.studio-icon]:!text-white/85 disabled:opacity-35',
        active ? 'bg-white/20' : 'hover:bg-white/10',
      )}
    >
      {children}
    </button>
  )
}
