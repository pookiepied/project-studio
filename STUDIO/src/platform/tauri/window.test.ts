import { describe, expect, it } from 'vitest'

import { resizeDirectionAt } from './window'

const panel = { width: 776, height: 901, inset: 28, radius: 40 }

describe('the resize band around the panel', () => {
  it('sits just outside each straight edge', () => {
    expect(resizeDirectionAt(24, 400, panel)).toBe('West')
    expect(resizeDirectionAt(750, 400, panel)).toBe('East')
    expect(resizeDirectionAt(400, 24, panel)).toBe('North')
    expect(resizeDirectionAt(400, 875, panel)).toBe('South')
  })

  it('leaves the panel itself and the far margin alone', () => {
    expect(resizeDirectionAt(28, 400, panel)).toBeNull()
    expect(resizeDirectionAt(400, 400, panel)).toBeNull()
    expect(resizeDirectionAt(5, 400, panel)).toBeNull()
    expect(resizeDirectionAt(400, 895, panel)).toBeNull()
  })

  it('follows the curve at the corners, where the panel is cut away', () => {
    // Outside the arc but inside the panel's bounding box: about 42px from the
    // corner's centre at (68, 68), along the diagonal.
    expect(resizeDirectionAt(38, 38, panel)).toBe('NorthWest')
    expect(resizeDirectionAt(738, 38, panel)).toBe('NorthEast')
    expect(resizeDirectionAt(38, 863, panel)).toBe('SouthWest')
    expect(resizeDirectionAt(738, 863, panel)).toBe('SouthEast')
    // Still on the panel, just inside the arc.
    expect(resizeDirectionAt(45, 45, panel)).toBeNull()
    // Past the band, in the empty corner of the margin.
    expect(resizeDirectionAt(20, 20, panel)).toBeNull()
  })

  it('has nothing to offer a maximized window, which fills the screen', () => {
    const maximized = { width: 1920, height: 1080, inset: 0, radius: 0 }
    expect(resizeDirectionAt(0, 0, maximized)).toBeNull()
    expect(resizeDirectionAt(1919, 540, maximized)).toBeNull()
  })
})
