/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AnsweredElsewhere } from './AnsweredElsewhere'

describe('AnsweredElsewhere', () => {
  it('announces the harness sentence verbatim, as a status', () => {
    render(<AnsweredElsewhere sentence="That approval is no longer pending." />)

    // The sentence is the harness's own, not a rewrite: this component's
    // whole job is to carry it to where the card was. `role="status"` is what
    // makes the telling reachable without seeing the screen.
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('That approval is no longer pending.')
  })
})
