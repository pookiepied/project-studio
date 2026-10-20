import { describe, expect, it } from 'vitest'
import { participantProfiles } from './participants'

describe('participant identity', () => {
  it('keeps names distinct beyond the name pool and stable across ordering', () => {
    const ids = Array.from({ length: 300 }, (_, index) => `task-${index}`)
    const profiles = participantProfiles(ids)
    expect(new Set([...profiles.values()].map((profile) => profile.name)).size).toBe(300)
    expect(participantProfiles([...ids].reverse())).toEqual(profiles)
    expect(profiles.get('task-1')).not.toEqual(profiles.get('task-2'))
  })
  it('keeps an existing participant identity when another joins', () => {
    const previous = participantProfiles(['worker'])
    expect(participantProfiles(['worker', 'new-worker'], previous).get('worker')).toEqual(previous.get('worker'))
  })
})
