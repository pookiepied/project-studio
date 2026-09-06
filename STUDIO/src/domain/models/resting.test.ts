import { describe, expect, it } from 'vitest'

import { restingReasoningLevel } from './types'

/**
 * Task 60: the dial that starts in the middle.
 *
 * Medium when the model supports it, otherwise the nearest supported level
 * in REASONING_LEVELS order, preferring the lower one on a tie.
 */
describe('the dial resting level', () => {
  it('rests on medium for a model that has it', () => {
    expect(restingReasoningLevel(['minimal', 'low', 'medium', 'high'])).toBe('medium')
  })

  it('rests on the nearest lower level when medium is missing', () => {
    expect(restingReasoningLevel(['minimal', 'low', 'xhigh', 'max'])).toBe('low')
  })

  it('prefers the lower level on a tie', () => {
    expect(restingReasoningLevel(['low', 'high'])).toBe('low')
  })
})
