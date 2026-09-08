/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScopeToggle } from './ScopeToggle'

/**
 * The tri-state, on its own, because this control is where Inherit dies if
 * anything collapses it.
 *
 * The invariant it pins: the control has THREE answers, they map onto the
 * wire's THREE values, and Inherit - `null`, the wider scope decides - is
 * neither On nor Off. Every screen that writes a scope renders this control,
 * so a flattening here would silently change what the model can reach on
 * every screen at once; that is why the mapping is proven both ways, reading
 * and writing, rather than once.
 */

const LABEL = 'Echo server in this project'

function renderToggle(value: boolean | null, onChange: (enabled: boolean | null) => void) {
  return render(
    <ScopeToggle value={value} onChange={onChange} ariaLabel={LABEL} layoutId="test-toggle" />,
  )
}

function checked(name: string): string | null {
  return screen
    .getByRole('radio', { name })
    .getAttribute('aria-checked')
}

afterEach(cleanup)

describe('the scope toggle', () => {
  it('reads Inherit as Inherit, not as Off, while this scope has no decision', () => {
    // The case the flattening bug fails. `null` reaches the control from a
    // project whose default says on; if the control collapsed it to a
    // checkbox, Off would light here and the project would behave - and read
    // - as switched off.
    renderToggle(null, vi.fn())

    expect(checked('Inherit')).toBe('true')
    expect(checked('Off')).toBe('false')
    expect(checked('On')).toBe('false')
  })

  it('reads the decision the scope actually made', () => {
    renderToggle(true, vi.fn())
    expect(checked('On')).toBe('true')
    expect(checked('Inherit')).toBe('false')

    cleanup()

    renderToggle(false, vi.fn())
    expect(checked('Off')).toBe('true')
    expect(checked('Inherit')).toBe('false')
  })

  it('sends the third value when the answer goes back to Inherit', () => {
    // `null`, not `false`: the harness clears on the first and switches off
    // on the second, and only one of those hands the question back to the
    // wider scope. This is the direction a stored decision returns by.
    const onChange = vi.fn()
    renderToggle(true, onChange)

    fireEvent.click(screen.getByRole('radio', { name: 'Inherit' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('sends the boolean the label names', () => {
    const onChange = vi.fn()
    renderToggle(null, onChange)

    fireEvent.click(screen.getByRole('radio', { name: 'Off' }))
    fireEvent.click(screen.getByRole('radio', { name: 'On' }))

    expect(onChange).toHaveBeenNthCalledWith(1, false)
    expect(onChange).toHaveBeenNthCalledWith(2, true)
  })
})
