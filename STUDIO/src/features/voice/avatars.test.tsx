/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CritterAvatar, moodOf } from './avatars'
import { participantProfiles } from './participants'
import { playCue } from './callSounds'

describe('call avatars', () => {
  it('reads a worker stage as a mood', () => {
    expect(moodOf('using_tool')).toBe('working')
    expect(moodOf('completed')).toBe('done')
    expect(moodOf('failed')).toBe('failed')
    expect(moodOf('cancelled')).toBe('stopped')
  })

  it('gives the same worker the same face', () => {
    const profile = participantProfiles(['voice_a']).get('voice_a')
    if (profile === undefined) throw new Error('No profile was assigned.')
    const first = render(<CritterAvatar profile={profile} mood="done" />).container.innerHTML
    const second = render(<CritterAvatar profile={profile} mood="done" />).container.innerHTML
    expect(first).toBe(second)
    expect(first).toContain(`hsl(${profile.hue}`)
  })

  it('plays a cue silently where there is no Web Audio', () => {
    expect(() => playCue('join')).not.toThrow()
  })
})
