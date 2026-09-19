import { describe, expect, it } from 'vitest'

import { effectiveTurnSettings } from './settings'
import type { Conversation, TurnSettings } from '@/domain/conversation/types'

/**
 * The derivation the picker displays and the send paths send - one function,
 * so the mode a conversation is held with is the mode its turns actually
 * travel under.
 */

const WINDOW: TurnSettings = {
  modelId: 'openai/gpt-4o',
  reasoningLevel: 'high',
  permission: 'ask',
}

const CONVERSATION: Conversation = {
  id: 'cnv_1',
  title: null,
  projectId: null,
  updatedAt: 1_000,
  pinned: false,
  archived: false,
  modelId: 'google/gemini-3.5-flash',
  reasoningLevel: 'low',
  permissionMode: 'auto',
}

describe('effectiveTurnSettings', () => {
  it('prefers the conversation stored mode over the window setting', () => {
    expect(effectiveTurnSettings(CONVERSATION, WINDOW).permission).toBe('auto')
  })

  it('falls back to the window setting where nothing is stored', () => {
    expect(effectiveTurnSettings(null, WINDOW).permission).toBe('ask')
  })

  it('keeps the model and reasoning rules it always had', () => {
    expect(effectiveTurnSettings(CONVERSATION, WINDOW).modelId).toBe(
      'google/gemini-3.5-flash',
    )
    expect(effectiveTurnSettings(null, WINDOW).modelId).toBe('openai/gpt-4o')
    expect(effectiveTurnSettings(null, WINDOW).reasoningLevel).toBe('high')
  })
})
