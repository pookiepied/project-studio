import { describe, expect, it } from 'vitest'
import { parseDelegatedComputerUse } from './useDelegatedComputerUse'

describe('delegated computer use', () => {
  it('names only unsettled tasks the harness marked as driving the computer', () => {
    expect(parseDelegatedComputerUse({ tasks: [
      { id: 'voice_1', agentName: 'voice-work', stage: 'waiting_for_model', computer: true },
      { id: 'child', agentName: 'explore', stage: 'using_tool' },
      { id: 'done', agentName: 'general', stage: 'completed', computer: true },
      { id: 7, agentName: 'general', stage: 'working', computer: true },
    ] })).toEqual([{ id: 'voice_1', agentName: 'voice-work' }])
    expect(parseDelegatedComputerUse(null)).toEqual([])
  })
})
