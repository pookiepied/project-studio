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


/**
 * A tool-calling turn, captured the same way.
 *
 * This is the shape the delegate's OpenRouter probe reported and the one the
 * grouping rule leans on, so it is pinned from real bytes rather than from a
 * fixture written to match the code. Two facts here are the whole reason the
 * projection is built the way it is:
 *
 *  - ONE submission spans TWO assistant messages. The tool step ends the
 *    first message and the answer starts a second, both carrying the same
 *    submissionId. "Turn", for grouping, therefore means assistant MESSAGE.
 *  - The tool answer arrives AFTER the message that issued it has already
 *    completed, and carries no message id -- only a toolCallId. Correlation
 *    has to be global; anything positional would drop it.
 */
const TOOL_TURN = [{"type": "conversation-reset", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "snapshot": {"v": 1, "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "offset": "0000000000000000_0000000000000000", "messages": [], "settlements": []}, "position": {"batch": 0, "index": 0}}, {"type": "message-appended", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "message": {"id": "entry_direct_MzIwYzY4M2EtODJlMi00ZTg0LWE4MGEtMzgwYmNiMjY2YTRi", "role": "user", "submissionId": "320c683a-82e2-4e84-a80a-380bcb266a4b", "metadata": {"timestamp": "2026-08-24T19:06:11.167Z"}, "parts": [{"type": "text", "text": "Summarize the workspace please.", "state": "done"}]}, "position": {"batch": 1, "index": 0}}, {"type": "message-started", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6483ba40-1605-418c-a347-7c7c329fa6ea", "timestamp": "2026-08-24T19:06:11.176Z", "submissionId": "320c683a-82e2-4e84-a80a-380bcb266a4b", "model": {"provider": "project-studio-test", "id": "default"}, "position": {"batch": 2, "index": 0}}, {"type": "tool-input", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6483ba40-1605-418c-a347-7c7c329fa6ea", "toolCallId": "workspace-summary-1", "toolName": "workspace_summary", "input": {"workspace": "Project Studio V2"}, "position": {"batch": 3, "index": 0}}, {"type": "message-completed", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6483ba40-1605-418c-a347-7c7c329fa6ea", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "position": {"batch": 4, "index": 0}}, {"type": "tool-output", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "toolCallId": "workspace-summary-1", "output": "{\"workspace\":\"Project Studio V2\",\"status\":\"ready\"}", "position": {"batch": 6, "index": 0}}, {"type": "message-started", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6661d15b-7f21-4d3d-9717-ae31957de1f7", "timestamp": "2026-08-24T19:06:11.200Z", "submissionId": "320c683a-82e2-4e84-a80a-380bcb266a4b", "model": {"provider": "project-studio-test", "id": "default"}, "position": {"batch": 7, "index": 0}}, {"type": "message-delta", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6661d15b-7f21-4d3d-9717-ae31957de1f7", "kind": "text", "delta": "Project ", "position": {"batch": 9, "index": 0}}, {"type": "message-delta", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6661d15b-7f21-4d3d-9717-ae31957de1f7", "kind": "text", "delta": "Studio V2 workspace is ready.", "position": {"batch": 9, "index": 1}}, {"type": "message-completed", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "messageId": "entry_6661d15b-7f21-4d3d-9717-ae31957de1f7", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "position": {"batch": 11, "index": 0}}, {"type": "submission-settled", "conversationId": "conv_01M0TJMYAC698CQ3PDCVP0ZRW5", "submissionId": "320c683a-82e2-4e84-a80a-380bcb266a4b", "outcome": "completed", "result": {"text": "Project Studio V2 workspace is ready.", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio", "id": "default"}}, "position": {"batch": 12, "index": 0}}]

function parseToolTurn() {
  const chunks = TOOL_TURN.map((chunk: unknown) => readChunkFacts(chunk))
  expect(chunks.every((chunk) => chunk !== null)).toBe(true)
  return chunks.filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null)
}

describe('a real tool-calling turn', () => {
  it('parses every chunk the live harness sent, in wire order', () => {
    expect(parseToolTurn().map((chunk) => chunk.type)).toEqual([
      'conversation-reset',
      'message-appended',
      'message-started',
      'tool-input',
      'message-completed',
      'tool-output',
      'message-started',
      'message-delta',
      'message-delta',
      'message-completed',
      'submission-settled',
    ])
  })

  it('splits one submission into two assistant messages and groups by the tool own name', () => {
    const after = applyChunks(emptyProjection(), parseToolTurn())
    const assistants = after.items.filter((item) => item.kind === 'assistant')
    expect(assistants).toHaveLength(2)

    const issuing = assistants[0]
    if (issuing?.kind !== 'assistant') throw new Error('no issuing message')
    const answering = assistants[1]
    if (answering?.kind !== 'assistant') throw new Error('no answering message')
    expect(issuing.submissionId).toBe(answering.submissionId)

    const tools = issuing.segments.find((segment) => segment.kind === 'tools')
    if (tools?.kind !== 'tools') throw new Error('no tools segment')
    expect(tools.groups).toHaveLength(1)
    expect(tools.groups[0]?.toolName).toBe('workspace_summary')
    expect(tools.groups[0]?.calls).toHaveLength(1)
  })

  it('lands the answer on its call even though the issuing message already completed', () => {
    const after = applyChunks(emptyProjection(), parseToolTurn())
    const issuing = after.items.filter((item) => item.kind === 'assistant')[0]
    if (issuing?.kind !== 'assistant') throw new Error('no issuing message')
    expect(issuing.end).toEqual({ state: 'complete' })

    const tools = issuing.segments.find((segment) => segment.kind === 'tools')
    if (tools?.kind !== 'tools') throw new Error('no tools segment')
    const call = tools.groups[0]?.calls[0]
    expect(call?.errorText).toBeNull()
    expect(call?.output?.present).toBe(true)
  })

  it('is idempotent when the whole turn is redelivered', () => {
    const once = applyChunks(emptyProjection(), parseToolTurn())
    expect(applyChunks(once, parseToolTurn())).toBe(once)
  })

  it('leaves the issuing message unfinished when the answer never arrives', () => {
    // Everything up to and including the tool input, and nothing after it.
    const truncated = parseToolTurn().slice(0, 4)
    const after = applyChunks(emptyProjection(), truncated)
    const issuing = after.items.filter((item) => item.kind === 'assistant')[0]
    if (issuing?.kind !== 'assistant') throw new Error('no issuing message')
    expect(issuing.end).toEqual({ state: 'stopped' })

    const tools = issuing.segments.find((segment) => segment.kind === 'tools')
    if (tools?.kind !== 'tools') throw new Error('no tools segment')
    // Pending, not failed: silence is not an error.
    expect(tools.groups[0]?.calls[0]?.output).toBeNull()
  })
})
