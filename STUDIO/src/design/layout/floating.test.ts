import { describe, expect, it } from 'vitest'
import { placeFloating } from './floating'

const viewport = { left: 0, top: 0, width: 420, height: 320, edge: 8 }
const anchor = { left: 360, top: 280, width: 30, height: 30 }

describe('floating surface bounds', () => {
  it('flips a bottom menu above its trigger and contains the right edge', () => {
    const placed = placeFloating({ anchor, panel: { width: 224, height: 180 }, viewport, side: 'bottom' })
    expect(placed.side).toBe('top')
    expect(placed.top).toBe(94)
    expect(placed.left).toBe(188)
  })

  it('contains an oversized surface instead of producing negative coordinates', () => {
    const placed = placeFloating({ anchor, panel: { width: 800, height: 600 }, viewport, side: 'top' })
    expect(placed.left).toBe(8)
    expect(placed.top).toBe(8)
    expect(placed.maxWidth).toBe(404)
    expect(placed.maxHeight).toBe(304)
  })

  it('uses the visual viewport origin when the keyboard or zoom changes visible space', () => {
    const placed = placeFloating({ anchor, panel: { width: 800, height: 600 },
      viewport: { left: 20, top: 100, width: 300, height: 180, edge: 8 }, side: 'bottom' })
    expect(placed.left).toBe(28)
    expect(placed.top).toBe(108)
    expect(placed.maxHeight).toBe(164)
  })

  it('repositions after larger type changes the measured menu dimensions', () => {
    const small = placeFloating({ anchor, panel: { width: 120, height: 90 }, viewport, side: 'top', align: 'end' })
    const large = placeFloating({ anchor, panel: { width: 240, height: 220 }, viewport, side: 'top', align: 'end' })
    expect(small.left).toBe(270)
    expect(large.left).toBe(150)
    expect(small.top).toBe(184)
    expect(large.top).toBe(54)
  })

  it('aligns a tooltip beside the trigger and contains its vertical edges', () => {
    const placed = placeFloating({ anchor: { left: 10, top: 0, width: 20, height: 20 },
      panel: { width: 150, height: 60 }, viewport, side: 'right', gap: 8 })
    expect(placed.left).toBe(38)
    expect(placed.top).toBe(8)
  })
})
