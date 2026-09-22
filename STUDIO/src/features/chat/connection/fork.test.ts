import { describe, expect, it } from 'vitest'

import { renderSeed, turnsUpTo, type SeedTurn } from './fork'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * The seed is the whole fork mechanism - Flue has no branch API, so the words
 * carried over ARE the inherited context. These pin the two halves: how much
 * of a conversation "up to here" is, and what the carried words look like when
 * they land in the new conversation's first message.
 */

function user(id: string, text: string): TranscriptItem {
  return {
    kind: 'user',
    id,
    submissionId: null,
    text,
    attachments: [],
    documents: [],
    timestamp: null,
  }
}

function assistant(id: string, text: string): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId: null,
    model: null,
    segments: [{ kind: 'text', id: `run-${id}`, text }],
    end: { state: 'complete' },
    usage: null,
  }
}

const conversation: readonly TranscriptItem[] = [
  user('u1', 'What eats reeds?'),
  assistant('a1', 'Many grazers do. Deer, for instance.'),
  user('u2', 'And in the water?'),
  assistant('a2', 'Beavers and moose both feed on them.'),
]

describe('turnsUpTo', () => {
  it('carries everything up to and including the named answer', () => {
    const turns = turnsUpTo(conversation, 'a1')
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(turns[1]?.text).toBe('Many grazers do. Deer, for instance.')
  })

  it('carries the whole conversation when the named answer is the last one', () => {
    expect(turnsUpTo(conversation, 'a2')).toHaveLength(4)
  })

  it('stops after the named answer even when more follows', () => {
    const turns = turnsUpTo([...conversation, user('u3', 'one more')], 'a1')
    expect(turns).toHaveLength(2)
  })
})

describe('renderSeed', () => {
  const turns: readonly SeedTurn[] = [
    { role: 'user', text: 'What eats reeds?' },
    { role: 'assistant', text: 'Deer, for instance.' },
  ]

  it('names the source and keeps the roles legible to a model', () => {
    const seed = renderSeed('Reeds', turns)
    expect(seed).toContain('"Reeds"')
    expect(seed).toContain('User: What eats reeds?')
    expect(seed).toContain('Assistant: Deer, for instance.')
    expect(seed).toContain('--- transcript ---')
  })

  it('survives an untitled source', () => {
    expect(renderSeed(null, turns)).toContain('this conversation')
  })
})
