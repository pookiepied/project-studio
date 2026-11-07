/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Stepper } from './Stepper'

afterEach(cleanup)

const button = (name: string) => screen.getByRole('button', { name })

describe('the stepper', () => {
  it('moves one choice at a time, over uneven steps', () => {
    const onChange = vi.fn()
    render(<Stepper label="UI scale" value={110} choices={[100, 110, 125]} onChange={onChange} format={(v) => `${v}%`} />)

    expect(screen.getByText('110%')).toBeTruthy()
    fireEvent.click(button('Increase UI scale'))
    expect(onChange).toHaveBeenLastCalledWith(125)
    fireEvent.click(button('Decrease UI scale'))
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('stops at each end', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Stepper label="Size" value={11} choices={[11, 12]} onChange={onChange} />)
    expect(button('Decrease size').hasAttribute('disabled')).toBe(true)

    rerender(<Stepper label="Size" value={12} choices={[11, 12]} onChange={onChange} />)
    expect(button('Increase size').hasAttribute('disabled')).toBe(true)
  })

  it('steps to a neighbour from a value no longer offered', () => {
    const onChange = vi.fn()
    render(<Stepper label="Size" value={13} choices={[11, 12, 14]} onChange={onChange} />)
    fireEvent.click(button('Increase size'))
    expect(onChange).toHaveBeenCalledWith(14)
  })
})
