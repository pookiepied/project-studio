/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Placeholder, PlaceholderMark, PlaceholderText } from './Placeholder'

/**
 * The bones.
 *
 * What is asserted is the contract the system rests on: bones are
 * `aria-hidden` (they never speak for content), the sweep is present where a
 * wait is being communicated and absent where a field is merely held, and the
 * sized primitives derive their geometry from the tokens rather than from
 * literals. How the sweep looks is the browser's business; that there is
 * exactly one implementation of it is the system's.
 */
afterEach(cleanup)

describe('Placeholder', () => {
  it('is a decorative field that carries no semantics of its own', () => {
    const { container } = render(<Placeholder className="h-4 w-40" />)
    const bone = container.firstElementChild
    expect(bone?.tagName).toBe('SPAN')
    expect(bone?.hasAttribute('aria-hidden')).toBe(true)
  })

  it('sweeps while it waits, and holds still when nothing is arriving', () => {
    const sweeping = render(<Placeholder className="h-4 w-40" />)
    const gradient = (root: HTMLElement): Element | null =>
      Array.from(root.querySelectorAll('span')).find((node) =>
        (node.getAttribute('style') ?? '').includes('linear-gradient'),
      ) ?? null
    expect(gradient(sweeping.container)).not.toBeNull()
    sweeping.unmount()

    const still = render(<Placeholder sweep={false} className="h-4 w-40" />)
    expect(gradient(still.container)).toBeNull()
  })

  it('centres its child above the sweep', () => {
    const { getByText } = render(
      <Placeholder className="h-4 w-40">
        <span>icon</span>
      </Placeholder>,
    )
    expect(getByText('icon')).not.toBeNull()
  })
})

describe('PlaceholderText', () => {
  it('is one line box of the composition it stands in', () => {
    const { container } = render(
      <div className="text-ui">
        <PlaceholderText className="w-1/2" />
      </div>,
    )
    const bone = container.querySelector('span[aria-hidden]')
    expect(bone?.className).toContain('h-[1lh]')
    expect(bone?.className).toContain('w-1/2')
  })
})

describe('PlaceholderMark', () => {
  it('is the icon tile, sized from the control step', () => {
    const { container } = render(<PlaceholderMark />)
    const bone = container.querySelector('span[aria-hidden]')
    expect(bone?.getAttribute('style')).toContain('width: 28px')
    expect(bone?.getAttribute('style')).toContain('height: 28px')
    expect(bone?.className).toContain('rounded-md')
  })

  it('takes the size the real mark renders at', () => {
    const { container } = render(<PlaceholderMark size={14} />)
    const bone = container.querySelector('span[aria-hidden]')
    expect(bone?.getAttribute('style')).toContain('width: 14px')
  })
})
