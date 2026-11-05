/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a tooltip in a constrained viewport', () => {
  it('wraps a long explanation and stays inside the viewport after a resize', () => {
    vi.stubGlobal('innerWidth', 240)
    vi.stubGlobal('innerHeight', 180)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
    render(<Tooltip label="A long explanation for a control that cannot be used yet" explainOnTap>
      <button type="button">Explain</button>
    </Tooltip>)
    fireEvent.pointerDown(screen.getByRole('button').parentElement ?? document.body, { pointerType: 'touch' })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.style.left).toBe('8px')
    expect(tooltip.style.maxWidth).toBe('224px')
    expect(tooltip.classList.contains('whitespace-nowrap')).toBe(false)
    vi.stubGlobal('innerWidth', 200)
    fireEvent(window, new Event('resize'))
    expect(tooltip.style.maxWidth).toBe('184px')
    expect(tooltip.style.left).toBe('8px')
  })
})
