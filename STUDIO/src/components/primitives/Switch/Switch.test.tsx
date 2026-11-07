/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Switch } from './Switch'

afterEach(cleanup)

describe('Switch', () => {
  it('reports its state and asks for the opposite one', () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="Sounds" />)
    const control = screen.getByRole('switch', { name: 'Sounds' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does nothing while disabled', () => {
    const onChange = vi.fn()
    render(<Switch checked onChange={onChange} label="Sounds" disabled />)
    fireEvent.click(screen.getByRole('switch', { name: 'Sounds' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
