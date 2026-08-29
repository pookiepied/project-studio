import { describe, expect, it } from 'vitest'
import { brandColorFor } from './brand-colors'

/**
 * The colour table's one job, and the two ways it says "wear the theme":
 * a vendor nobody has a colour for, and a vendor whose colour is so dark it
 * would vanish on a dark background.
 */
describe('the brand colour table', () => {
  it('names the vendors it has real colours for', () => {
    expect(brandColorFor('deepseek')).toBe('#5786FE')
    expect(brandColorFor('google')).toBe('#4285F4')
    expect(brandColorFor('mistralai')).toBe('#FA520F')
  })

  it('answers undefined for a vendor it does not know', () => {
    expect(brandColorFor('the-box-next-door')).toBeUndefined()
    expect(brandColorFor('')).toBeUndefined()
  })

  it('refuses colours that would vanish on a dark background', () => {
    // Anthropic's Simple Icons colour is near-black; wearing it on a dark
    // theme is a mark nobody can see, so it resolves to the theme instead.
    expect(brandColorFor('anthropic')).toBeUndefined()
  })
})
