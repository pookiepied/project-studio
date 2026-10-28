/**
 * The person's drawing on the shared screen, reduced to what a model can use
 * (ADR 0059).
 *
 * The ink itself stays on screen, so the next picture shows it exactly. What
 * travels to the harness is a summary of each stroke: whether it went round
 * something, across something, or tapped one place, and the box it covers,
 * in the desktop's physical pixels - the same space a click is in. Points
 * are never sent; a shape is enough to answer "this one" and small enough to
 * sit in a turn's context.
 */

export interface InkPoint {
  readonly x: number
  readonly y: number
}

export type ShapeKind = 'loop' | 'line' | 'dot' | 'scribble'

export interface DrawnShape {
  readonly shape: ShapeKind
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Where the drawing window sits on the desktop, in physical pixels, and its scale. */
export interface MonitorPlace {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
}

/** A stroke this small, in CSS pixels, is a tap rather than a line. */
const DOT_SPAN = 8
/** A line this close to straight - endpoints apart over length travelled - is a line. */
const STRAIGHT = 0.86

function length(points: readonly InkPoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

export function boundsOf(points: readonly InkPoint[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** What one stroke was: a tap, a straight line, a closed loop, or anything else. */
export function shapeOf(points: readonly InkPoint[]): ShapeKind {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return 'dot'
  const box = boundsOf(points)
  if (Math.max(box.width, box.height) < DOT_SPAN) return 'dot'
  const travelled = length(points)
  const apart = Math.hypot(last.x - first.x, last.y - first.y)
  if (travelled > 0 && apart / travelled >= STRAIGHT) return 'line'
  // Closed when the pen came back near where it began, relative to the size
  // of what it went round: people rarely close a circle exactly.
  const span = Math.max(box.width, box.height)
  // A circle stopped nine tenths of the way round leaves a gap of about a
  // third of its width; that is still a circle to the person who drew it.
  if (apart <= Math.max(24, span * 0.35) && travelled >= span * 2) return 'loop'
  return 'scribble'
}

/** One stroke, summarised, in the desktop's physical pixels. */
export function summarize(points: readonly InkPoint[], monitor: MonitorPlace): DrawnShape | null {
  if (points.length === 0) return null
  const box = boundsOf(points)
  return {
    shape: shapeOf(points),
    x: Math.round(monitor.x + box.x * monitor.scale),
    y: Math.round(monitor.y + box.y * monitor.scale),
    width: Math.round(box.width * monitor.scale),
    height: Math.round(box.height * monitor.scale),
  }
}

/**
 * A smooth SVG path through the points: straight segments between the
 * midpoints, each corner rounded by a quadratic curve through the sample.
 * Freehand ink drawn as raw polylines looks like a seismograph.
 */
export function inkPath(points: readonly InkPoint[]): string {
  const first = points[0]
  if (first === undefined) return ''
  if (points.length === 1) return `M${first.x} ${first.y}l0.01 0`
  let path = `M${first.x} ${first.y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    if (point === undefined || next === undefined) continue
    path += ` Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = points[points.length - 1]
  if (last !== undefined) path += ` L${last.x} ${last.y}`
  return path
}
