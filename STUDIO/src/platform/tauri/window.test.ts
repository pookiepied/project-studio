import { PhysicalSize } from '@tauri-apps/api/dpi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyWindowSize, readWindowSize, resizeDirectionAt } from './window'

const native = vi.hoisted(() => ({
  unmaximize: vi.fn(),
  setSize: vi.fn(),
  center: vi.fn(),
  isMaximized: vi.fn(() => false),
  innerSize: vi.fn<() => PhysicalSize>(),
  scaleFactor: vi.fn(() => 1),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => native }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('desktop window presets', () => {
  it.each([
    { size: 'standard', availWidth: 1920, availHeight: 1200, width: 1280, height: 800 },
    { size: 'standard', availWidth: 1024, availHeight: 720, width: 1024, height: 640 },
    { size: 'compact', availWidth: 1920, availHeight: 1200, width: 776, height: 901 },
    { size: 'compact', availWidth: 1280, availHeight: 720, width: 776, height: 720 },
  ] as const)('sets and recognizes $size at $width x $height', async ({ size, availWidth, availHeight, width, height }) => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, screen: { availWidth, availHeight } })
    native.innerSize.mockReturnValue(new PhysicalSize(width, height))

    await applyWindowSize(size)

    expect(native.setSize).toHaveBeenCalledWith(expect.objectContaining({ width, height }))
    expect(await readWindowSize()).toBe(size)
  })
})

const panel = { width: 776, height: 901, inset: 28, radius: 20 }

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
    // Outside the arc but inside the panel's bounding box.
    expect(resizeDirectionAt(32, 32, panel)).toBe('NorthWest')
    expect(resizeDirectionAt(744, 32, panel)).toBe('NorthEast')
    expect(resizeDirectionAt(32, 869, panel)).toBe('SouthWest')
    expect(resizeDirectionAt(744, 869, panel)).toBe('SouthEast')
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
