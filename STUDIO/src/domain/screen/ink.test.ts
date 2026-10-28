import { describe, expect, it } from 'vitest'
import { inkPath, shapeOf, summarize, type InkPoint } from './ink'

function circle(cx: number, cy: number, r: number, steps = 24, sweep = 1): InkPoint[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2 * sweep
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })
}

describe('a stroke, reduced to what it was', () => {
  it('tells a tap, a line, a loop and a scribble apart', () => {
    expect(shapeOf([{ x: 10, y: 10 }, { x: 12, y: 11 }])).toBe('dot')
    expect(shapeOf([{ x: 0, y: 0 }, { x: 50, y: 4 }, { x: 100, y: 6 }])).toBe('line')
    expect(shapeOf(circle(100, 100, 40))).toBe('loop')
    // People rarely close a circle: nine tenths of the way round is still one.
    expect(shapeOf(circle(100, 100, 40, 24, 0.9))).toBe('loop')
    expect(shapeOf([{ x: 0, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 60 }, { x: 70, y: 90 }])).toBe('scribble')
  })

  it('places the box in desktop pixels, from the display the window covers and its scale', () => {
    const monitor = { x: 1920, y: 0, width: 2560, height: 1440, scale: 1.5 }
    expect(summarize(circle(100, 100, 40), monitor)).toEqual({ shape: 'loop', x: 1920 + 90, y: 90, width: 120, height: 120 })
    expect(summarize([], monitor)).toBeNull()
  })

  it('draws a smooth path that starts and ends where the pen did', () => {
    const path = inkPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    expect(path.startsWith('M0 0')).toBe(true)
    expect(path).toContain('Q10 0 10 5')
    expect(path.endsWith('L10 10')).toBe(true)
    expect(inkPath([])).toBe('')
  })
})
