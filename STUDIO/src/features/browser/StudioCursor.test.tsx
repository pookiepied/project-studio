/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioCursor } from './StudioCursor'

afterEach(cleanup)
const cursor = { x: 0.5, y: 0.5, tabId: 'tab_1', pressed: false, pressSequence: 5 }

describe('Studio click feedback', () => {
  it('shows a click completed between polls, without replaying an initial or repeated snapshot', async () => {
    const view = render(<StudioCursor cursor={cursor} />)
    expect(view.container.querySelector('[data-feedback="click"]')).toBeNull()
    await act(async () => view.rerender(<StudioCursor cursor={{ ...cursor, pressSequence: 6 }} />))
    const pulse = view.container.querySelector('[data-feedback="click"]')
    expect(pulse?.getAttribute('data-press-sequence')).toBe('6')
    view.rerender(<StudioCursor cursor={{ ...cursor, pressSequence: 6, x: 0.7 }} />)
    expect(view.container.querySelector('[data-feedback="click"]')).toBe(pulse)
  })
  it('shows held input and keeps an older sample from generating a new pulse', async () => {
    const view = render(<StudioCursor cursor={{ ...cursor, pressed: true }} />)
    expect(view.container.querySelector('[data-feedback="press"]')).not.toBeNull()
    await act(async () => view.rerender(<StudioCursor cursor={{ ...cursor, pressSequence: 4 }} />))
    expect(view.container.querySelector('[data-feedback="click"]')).toBeNull()
  })
})
