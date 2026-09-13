/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DURATION } from '@/design/tokens'
import { TextLanding, landingDuration } from './TextLanding'

/**
 * The landing is bounded: a passage of any length finishes arriving inside
 * one slow duration plus one word's fade. That is what lets the composer
 * hold the field back for exactly that long without a long dictation
 * turning the wait into a wait.
 */
describe('a passage landing', () => {
  it('keeps the spread inside the slow duration however long the passage', () => {
    const short = landingDuration('three short words')
    const long = landingDuration('word '.repeat(400))
    expect(short).toBeGreaterThan(DURATION.base)
    expect(long).toBeLessThanOrEqual(DURATION.slow + DURATION.base + 1e-9)
    expect(landingDuration('one')).toBe(DURATION.base)
  })

  it('shows every word, and keeps the whitespace the field will keep', () => {
    const { container } = render(<TextLanding text={'First line.\nSecond  line.'} />)
    expect(container.textContent).toBe('First line.\nSecond  line.')
    // Only the words animate; the whitespace between them is plain.
    expect(container.querySelectorAll('span.inline-block')).toHaveLength(4)
  })
})
