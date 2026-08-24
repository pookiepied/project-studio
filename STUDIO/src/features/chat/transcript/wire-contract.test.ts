import { describe, expect, it } from 'vitest'
import { readChunkFacts } from '@/platform/harness'
import { applyChunks, emptyProjection } from './projection'

// Captured verbatim from a live harness on 2026-08-25 (test model source).
const RAW = `[{"type":"conversation-reset","conversationId":"conv_01M0","snapshot":{"v":1,"conversationId":"conv_01M0","offset":"0000000000000000_0000000000000000","messages":[],"settlements":[]},"position":{"batch":0,"index":0}},{"type":"message-appended","conversationId":"conv_01M0","message":{"id":"entry_direct_X","role":"user","submissionId":"sub-1","metadata":{"timestamp":"2026-08-24T18:43:19.716Z"},"parts":[{"type":"text","text":"Say hello.","state":"done"}]},"position":{"batch":1,"index":0}},{"type":"message-started","conversationId":"conv_01M0","messageId":"entry_A","timestamp":"2026-08-24T18:43:19.725Z","submissionId":"sub-1","model":{"provider":"project-studio-test","id":"default"},"position":{"batch":2,"index":0}},{"type":"message-delta","conversationId":"conv_01M0","messageId":"entry_A","kind":"text","delta":"Echo: Sa","position":{"batch":4,"index":0}},{"type":"message-delta","conversationId":"conv_01M0","messageId":"entry_A","kind":"text","delta":"y hello.","position":{"batch":4,"index":1}},{"type":"message-completed","conversationId":"conv_01M0","messageId":"entry_A","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"position":{"batch":6,"index":0}},{"type":"submission-settled","conversationId":"conv_01M0","submissionId":"sub-1","outcome":"completed","result":{"text":"Echo: Say hello.","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"model":{"provider":"project-studio","id":"default"}},"position":{"batch":7,"index":0}}]`

function parse() {
  const value: unknown = JSON.parse(RAW)
  if (!Array.isArray(value)) throw new Error('not an array')
  const chunks = value.map(readChunkFacts)
  expect(chunks.every((c) => c !== null)).toBe(true)
  return chunks.filter((c): c is NonNullable<typeof c> => c !== null)
}

describe('the real wire payload', () => {
  it('parses every chunk the live harness sent', () => {
    const chunks = parse()
    expect(chunks.map((c) => c.type)).toEqual([
      'conversation-reset', 'message-appended', 'message-started',
      'message-delta', 'message-delta', 'message-completed', 'submission-settled',
    ])
  })

  it('renders as a user turn and one completed assistant turn', () => {
    const after = applyChunks(emptyProjection(), parse())
    expect(after.items).toHaveLength(2)
    const [user, assistant] = after.items
    expect(user).toMatchObject({ kind: 'user', text: 'Say hello.' })
    expect(assistant?.kind).toBe('assistant')
    if (assistant?.kind !== 'assistant') throw new Error('no assistant')
    expect(assistant.end).toEqual({ state: 'complete' })
    expect(assistant.segments).toEqual([
      { kind: 'text', id: expect.any(String), text: 'Echo: Say hello.' },
    ])
  })

  it('is idempotent when the same batch is redelivered', () => {
    const once = applyChunks(emptyProjection(), parse())
    const twice = applyChunks(once, parse())
    expect(twice).toBe(once)
  })

  it('leaves a turn cut short before settlement visibly unfinished', () => {
    const truncated = parse().slice(0, 5) // through the last delta, no completion
    const after = applyChunks(emptyProjection(), truncated)
    const assistant = after.items[1]
    if (assistant?.kind !== 'assistant') throw new Error('no assistant')
    expect(assistant.end).toEqual({ state: 'stopped' })
  })
})
