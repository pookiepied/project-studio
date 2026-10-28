import { describe, expect, it } from 'vitest'
import { matchControl, normaliseUtterance } from './controlMatcher'

const idle = { paused: false, sharing: false }

describe('the spoken words that act at once', () => {
  it('acts on the whole phrase, whatever its punctuation or a leading "Studio"', () => {
    expect(matchControl('Stop the computer.', idle)).toBe('stop_computer')
    expect(matchControl('Studio, stop using my computer!', idle)).toBe('stop_computer')
    expect(matchControl('Pause, please.', idle)).toBe('pause')
    expect(normaliseUtterance("Hey Studio, let's  go")).toBe('lets go')
  })

  it('leaves anything more, or anything ambiguous, to the model', () => {
    expect(matchControl('Stop that.', idle)).toBeNull()
    expect(matchControl('What does stop mean here?', idle)).toBeNull()
    expect(matchControl('Stop the computer from sleeping.', idle)).toBeNull()
    expect(matchControl('Yeah, keep going.', { paused: true, sharing: true })).toBeNull()
    expect(matchControl('Stop Hazel.', idle)).toBeNull()
  })

  it('continues only a paused computer, and shows only on a shared screen', () => {
    expect(matchControl('Continue.', idle)).toBeNull()
    expect(matchControl('Continue.', { paused: true, sharing: false })).toBe('resume')
    expect(matchControl('Wait, let me show you.', idle)).toBeNull()
    expect(matchControl('Wait, let me show you.', { paused: false, sharing: true })).toBe('show_me')
  })
})
