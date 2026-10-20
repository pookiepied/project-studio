/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { agentKind, ParticipantTiles, withNames } from './CallParticipants'
import { participantProfiles } from './participants'

vi.mock('./callSounds', () => ({ playCue: vi.fn() }))

const task = { id: 'voice_1', agentName: 'voice-work', stage: 'working', updatedAt: 0, createdAt: 0, name: 'Hazel' }

describe('call participants', () => {
  afterEach(cleanup)

  it('uses the name the harness gave the task, the one the voice agent says', () => {
    const profiles = withNames(participantProfiles([task.id]), [task])
    expect(profiles.get(task.id)?.name).toBe('Hazel')
    expect(profiles.get(task.id)?.initials).toBe('Ha')
  })

  it('keeps the local name when the harness gave none', () => {
    const local = participantProfiles([task.id])
    const { name: _omitted, ...unnamed } = task
    expect(withNames(local, [unnamed]).get(task.id)?.name).toBe(local.get(task.id)?.name)
  })

  it('calls a voice task a Studio agent and a delegate by its kind', () => {
    expect(agentKind('voice-work')).toBe('Studio agent')
    expect(agentKind('explore')).toBe('Explore agent')
    render(<ParticipantTiles participants={[task]} profiles={withNames(participantProfiles([task.id]), [task])} expanded />)
    expect(screen.getByText('Hazel')).toBeTruthy()
    expect(screen.getByText('Studio agent')).toBeTruthy()
  })
})
