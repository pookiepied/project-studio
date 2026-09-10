/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { QrCode } from './QrCode'

afterEach(cleanup)

describe('QrCode', () => {
  it('draws a square of modules with a quiet zone, black on white', () => {
    render(<QrCode value="http://192.168.1.47:4747" label="QR code for the address" />)

    const svg = screen.getByRole('img', { name: 'QR code for the address' })
    const modules = Number(svg.getAttribute('data-modules'))
    // A version-1 code is 21 modules a side and grows by 4 per version; a
    // short URL at level M fits in the first few versions.
    expect(modules).toBeGreaterThanOrEqual(21)
    expect((modules - 21) % 4).toBe(0)
    // Four modules of quiet zone on each side, in the viewBox.
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${modules + 8} ${modules + 8}`)

    const [ground, marks] = Array.from(svg.children)
    expect(ground.getAttribute('fill')).toBe('#fff')
    expect(marks.getAttribute('fill')).toBe('#000')
    // The finder pattern's top edge: seven dark modules from the quiet
    // zone's corner, which every code has and a wrong offset would move.
    expect(marks.getAttribute('d')?.startsWith('M4 4h7v1h-7z')).toBe(true)
  })

  it('draws a different code for a different address', () => {
    const { unmount } = render(<QrCode value="http://192.168.1.47:4747" label="one" />)
    const first = screen.getByRole('img', { name: 'one' }).children[1].getAttribute('d')
    unmount()

    render(<QrCode value="http://10.0.0.5:4747" label="two" />)
    const second = screen.getByRole('img', { name: 'two' }).children[1].getAttribute('d')

    expect(first).not.toBe(second)
  })
})
