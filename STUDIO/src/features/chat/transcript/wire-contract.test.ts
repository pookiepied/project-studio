import { describe, expect, it } from 'vitest'
import { readChunkFacts, readConversationSnapshot } from '@/platform/harness'
import {
  applyChunks,
  emptyProjection,
  seededProjection,
} from './projection'

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
 *    completed, and carries no message id — only a toolCallId. Correlation
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
    expect(tools.groups[0]?.calls).toHaveLength(1)
    expect(tools.groups[0]?.calls[0]?.toolName).toBe('workspace_summary')
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


/**
 * A rate-limited turn, captured from a real harness on 2026-08-25 (test
 * model source, `[fail]` in the prompt, Flue's three transient retries
 * exhausted at their real ~14s pace).
 *
 * This is the payload Task 26 exists for, so its shape is worth stating
 * exactly. Four `message-started`/`message-completed` pairs — one per retry
 * attempt, each closing its own record cleanly with zero usage — arrive
 * BEFORE the settlement, and none of them says anything went wrong. The only
 * honest fact about the failure is the settlement's `error` object: Flue's
 * own sentence for why the provider refused four times.
 *
 * Task 25's parser dropped that object at exactly this line, and the turn
 * rendered as four empty assistant messages all marked complete. This pin is
 * here so the failure can never silently become invisible again.
 */
const FAILED_TURN = [
  { type: 'conversation-reset', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', snapshot: { v: 1, conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', offset: '0000000000000000_0000000000000000', messages: [], settlements: [] }, position: { batch: 0, index: 0 } },
  { type: 'message-appended', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', message: { id: 'entry_direct_NTBiN2E0ZTUtMGRiMC00YzM0LWE5YmMtNDUxMDc3MjA0NDA0', role: 'user', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', metadata: { timestamp: '2026-08-24T20:03:56.097Z' }, parts: [{ type: 'text', text: '[fail] please answer.', state: 'done' }] }, position: { batch: 1, index: 0 } },
  { type: 'message-started', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_1dbfb415-4840-4238-a49f-3587cf16d20f', timestamp: '2026-08-24T20:03:56.108Z', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', model: { provider: 'project-studio-test', id: 'default' }, position: { batch: 2, index: 0 } },
  { type: 'message-completed', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_1dbfb415-4840-4238-a49f-3587cf16d20f', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, position: { batch: 3, index: 0 } },
  { type: 'message-started', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_8c257a3c-1452-45bd-a5aa-f25c1ce10a6f', timestamp: '2026-08-24T20:03:57.937Z', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', model: { provider: 'project-studio-test', id: 'default' }, position: { batch: 4, index: 0 } },
  { type: 'message-completed', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_8c257a3c-1452-45bd-a5aa-f25c1ce10a6f', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, position: { batch: 5, index: 0 } },
  { type: 'message-started', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_d873b3ed-2f58-45c2-9627-946899139e6d', timestamp: '2026-08-24T20:04:01.496Z', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', model: { provider: 'project-studio-test', id: 'default' }, position: { batch: 6, index: 0 } },
  { type: 'message-completed', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_d873b3ed-2f58-45c2-9627-946899139e6d', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, position: { batch: 7, index: 0 } },
  { type: 'message-started', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_39090cc2-7820-4a79-8f08-dd005aaa82c4', timestamp: '2026-08-24T20:04:09.089Z', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', model: { provider: 'project-studio-test', id: 'default' }, position: { batch: 8, index: 0 } },
  { type: 'message-completed', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', messageId: 'entry_39090cc2-7820-4a79-8f08-dd005aaa82c4', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, position: { batch: 9, index: 0 } },
  { type: 'submission-settled', conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', outcome: 'failed', error: { name: 'FlueError', message: 'direct(50b7a4e5-0db0-4c34-a9bc-451077204404) failed: 429 rate limit exceeded: temporarily rate-limited upstream', type: 'operation_failed', details: '' }, position: { batch: 10, index: 0 } },
]

const RATE_LIMIT_SENTENCE =
  'direct(50b7a4e5-0db0-4c34-a9bc-451077204404) failed: 429 rate limit exceeded: temporarily rate-limited upstream'

function parseFailedTurn() {
  const chunks = FAILED_TURN.map((chunk: unknown) => readChunkFacts(chunk))
  expect(chunks.every((chunk) => chunk !== null)).toBe(true)
  return chunks.filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null)
}

describe('a real rate-limited turn', () => {
  it('parses every chunk the live harness sent, in wire order', () => {
    expect(parseFailedTurn().map((chunk) => chunk.type)).toEqual([
      'conversation-reset',
      'message-appended',
      'message-started',
      'message-completed',
      'message-started',
      'message-completed',
      'message-started',
      'message-completed',
      'message-started',
      'message-completed',
      'submission-settled',
    ])
  })

  it('carries the settlement error out of the parser instead of dropping it', () => {
    const settled = parseFailedTurn().at(-1)
    expect(settled?.outcome).toBe('failed')
    expect(settled?.errorMessage).toBe(RATE_LIMIT_SENTENCE)
    expect(settled?.errorName).toBe('FlueError')
    expect(settled?.errorType).toBe('operation_failed')
  })

  it('renders as ONE visible failure, not four empty completed bubbles', () => {
    const after = applyChunks(emptyProjection(), parseFailedTurn())
    expect(after.items).toHaveLength(2)
    const [user, failure] = after.items
    expect(user).toMatchObject({ kind: 'user', text: '[fail] please answer.' })
    expect(failure?.kind).toBe('submission-failed')
    if (failure?.kind !== 'submission-failed') throw new Error('no failure item')
    expect(failure.submissionId).toBe('50b7a4e5-0db0-4c34-a9bc-451077204404')
    expect(failure.outcome).toBe('failed')
    // The one sentence a person could act on, straight from the wire.
    expect(failure.reason).toBe(RATE_LIMIT_SENTENCE)
    // No assistant item survives, because no attempt ever said anything.
    expect(after.items.some((item) => item.kind === 'assistant')).toBe(false)
  })

  it('is idempotent when the whole failed turn is redelivered', () => {
    const once = applyChunks(emptyProjection(), parseFailedTurn())
    expect(applyChunks(once, parseFailedTurn())).toBe(once)
  })
})

/**
 * The SAME failed conversation as its history view returns it, captured at
 * the same moment as the updates above.
 *
 * Two facts make this pin load-bearing for cold starts. The four attempts
 * materialize as assistant messages with `parts: []` — so "an attempt that
 * never spoke" has the same shape in history as live, and one rule can serve
 * both. And those assistant messages carry NO `submissionId` (the field the
 * SDK calls optional on tracked messages), which is how a cold start came to
 * render them as complete bubbles: matching settlements by message id alone
 * found nothing to mark. Position — between this settlement's user message
 * and the next user message — is the only association history offers.
 */
const FAILED_HISTORY = { v: 1, conversationId: 'conv_01M0TNYP1A7FVY39X70CRV91Y2', offset: '0000000000000000_0000000000000010', messages: [ { id: 'entry_direct_NTBiN2E0ZTUtMGRiMC00YzM0LWE5YmMtNDUxMDc3MjA0NDA0', role: 'user', submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', parts: [{ type: 'text', text: '[fail] please answer.', state: 'done' }], metadata: { timestamp: '2026-08-24T20:03:56.097Z' } }, { id: 'entry_1dbfb415-4840-4238-a49f-3587cf16d20f', role: 'assistant', parts: [], metadata: { timestamp: '2026-08-24T20:03:56.108Z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, model: { provider: 'project-studio-test', id: 'default' } } }, { id: 'entry_8c257a3c-1452-45bd-a5aa-f25c1ce10a6f', role: 'assistant', parts: [], metadata: { timestamp: '2026-08-24T20:03:57.937Z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, model: { provider: 'project-studio-test', id: 'default' } } }, { id: 'entry_d873b3ed-2f58-45c2-9627-946899139e6d', role: 'assistant', parts: [], metadata: { timestamp: '2026-08-24T20:04:01.496Z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, model: { provider: 'project-studio-test', id: 'default' } } }, { id: 'entry_39090cc2-7820-4a79-8f08-dd005aaa82c4', role: 'assistant', parts: [], metadata: { timestamp: '2026-08-24T20:04:09.089Z', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, model: { provider: 'project-studio-test', id: 'default' } } } ], settlements: [ { submissionId: '50b7a4e5-0db0-4c34-a9bc-451077204404', outcome: 'failed', error: { name: 'FlueError', message: 'direct(50b7a4e5-0db0-4c34-a9bc-451077204404) failed: 429 rate limit exceeded: temporarily rate-limited upstream', type: 'operation_failed', details: '' } } ] }

describe('a cold start reading the same failed conversation as history', () => {
  it('seeds into the same visible failure the live path produced', () => {
    const snapshot = readConversationSnapshot(FAILED_HISTORY)
    expect(snapshot).not.toBeNull()
    if (snapshot === null) throw new Error('unreachable')
    const items = seededProjection(snapshot).items
    expect(items).toHaveLength(2)
    const [, failure] = items
    expect(failure?.kind).toBe('submission-failed')
    if (failure?.kind !== 'submission-failed') throw new Error('no failure item')
    expect(failure.reason).toBe(RATE_LIMIT_SENTENCE)
    expect(items.some((item) => item.kind === 'assistant')).toBe(false)
  })
})


/**
 * A cold start on a conversation holding BOTH a success and a failure.
 *
 * Captured from a live harness: one ordinary turn, then a `[fail]` turn that
 * burned its three retries. This is the stress case for the positional
 * association a cold start is forced into, because assistant messages in a
 * snapshot carry no submissionId — only user messages do (verified on the
 * wire; every assistant here reads `undefined`).
 *
 * If the adjacency rule were even slightly loose, the earlier successful
 * turn would be swallowed by the later failure and real work would render as
 * a rate limit. That is the regression this fixture exists to catch.
 */
const MIXED_HISTORY = {"v": 1, "conversationId": "conv_01M0TRV3R03P1DT39TZT4Z9WEZ", "offset": "0000000000000000_0000000000000017", "messages": [{"id": "entry_direct_ZmE5OTllOTQtYzRhNy00NjFiLTg2MGUtOTk1NWExZTcyMTkw", "role": "user", "submissionId": "fa999e94-c4a7-461b-860e-9955a1e72190", "parts": [{"type": "text", "text": "Say hello.", "state": "done"}], "metadata": {"timestamp": "2026-08-24T20:54:24.787Z"}}, {"id": "entry_2e104e81-bb88-4992-be80-0ec1de75a367", "role": "assistant", "parts": [{"type": "text", "text": "Echo: Say hello.", "state": "done"}], "metadata": {"timestamp": "2026-08-24T20:54:24.795Z", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio-test", "id": "default"}}}, {"id": "entry_direct_ZTE4YmUyNjAtMTYyOC00ZWJkLWFhM2ItMjBmNWNiZmRjMTYx", "role": "user", "submissionId": "e18be260-1628-4ebd-aa3b-20f5cbfdc161", "parts": [{"type": "text", "text": "[fail] now break.", "state": "done"}], "metadata": {"timestamp": "2026-08-24T20:54:29.813Z"}}, {"id": "entry_f5789144-a243-4d68-868a-b3c9ee987090", "role": "assistant", "parts": [], "metadata": {"timestamp": "2026-08-24T20:54:29.818Z", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio-test", "id": "default"}}}, {"id": "entry_294a9b2a-a1ac-410b-ad6d-f97523e438a6", "role": "assistant", "parts": [], "metadata": {"timestamp": "2026-08-24T20:54:31.488Z", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio-test", "id": "default"}}}, {"id": "entry_3cc1dced-b4d6-45f2-acf9-f99003d4e962", "role": "assistant", "parts": [], "metadata": {"timestamp": "2026-08-24T20:54:34.677Z", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio-test", "id": "default"}}}, {"id": "entry_1eef2c7d-0334-4032-805f-bd8b06497b5b", "role": "assistant", "parts": [], "metadata": {"timestamp": "2026-08-24T20:54:41.537Z", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio-test", "id": "default"}}}], "settlements": [{"submissionId": "fa999e94-c4a7-461b-860e-9955a1e72190", "outcome": "completed", "result": {"text": "Echo: Say hello.", "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}, "model": {"provider": "project-studio", "id": "default"}}}, {"submissionId": "e18be260-1628-4ebd-aa3b-20f5cbfdc161", "outcome": "failed", "error": {"name": "FlueError", "message": "direct(e18be260-1628-4ebd-aa3b-20f5cbfdc161) failed: 429 rate limit exceeded: temporarily rate-limited upstream", "type": "operation_failed", "details": ""}}]}

describe('a cold start on a mixed conversation', () => {
  it('carries submissionId on user messages and none on assistant messages', () => {
    const snapshot = readConversationSnapshot(MIXED_HISTORY)
    expect(snapshot).not.toBeNull()
    if (snapshot === null) throw new Error('unreadable snapshot')
    const roles = snapshot.messages.map((message) => message.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'assistant', 'assistant', 'assistant'])
    for (const message of snapshot.messages) {
      if (message.role === 'user') expect(message.submissionId).not.toBeNull()
      else expect(message.submissionId).toBeNull()
    }
  })

  it('keeps the finished turn finished and collapses only the failed one', () => {
    const snapshot = readConversationSnapshot(MIXED_HISTORY)
    if (snapshot === null) throw new Error('unreadable snapshot')
    const items = seededProjection(snapshot).items

    expect(items.map((item) => item.kind)).toEqual([
      'user',
      'assistant',
      'user',
      'submission-failed',
    ])

    const answered = items[1]
    if (answered?.kind !== 'assistant') throw new Error('no assistant')
    expect(answered.end).toEqual({ state: 'complete' })
    expect(answered.segments.map((segment) => segment.kind)).toEqual(['text'])

    const failure = items[3]
    if (failure?.kind !== 'submission-failed') throw new Error('no failure item')
    expect(failure.outcome).toBe('failed')
    expect(failure.reason).toContain('rate limit')
  })
})
