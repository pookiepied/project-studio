import { describe, expect, it } from 'vitest'

import {
  executionModeFromWire,
  executionModeToWire,
  parseHarnessErrorBody,
  parseModelCapability,
  parsePendingApprovals,
  parseProbeResult,
  parseProviderConnection,
  parseProviderModel,
  parseProviderModels,
  parseWireStreamEvent,
  readChunkFacts,
  readConversationSnapshot,
} from './contracts'

/**
 * The parsers, on their own.
 *
 * The client tests prove these are actually used; these prove they are right.
 * Every case here is a body the harness could plausibly send after a contract
 * change, plus the ones a compromised or confused peer could send deliberately.
 */

const CAPABILITY = {
  textGeneration: 'supported',
  streaming: 'supported',
  reasoning: 'unknown',
  toolCalling: 'supported',
  vision: 'unsupported',
  embeddings: 'unsupported',
  reranking: 'unsupported',
  imageGeneration: 'unsupported',
  imageEditing: 'unsupported',
  videoGeneration: 'unsupported',
  speechGeneration: 'unsupported',
  transcription: 'unsupported',
  webSearch: 'unsupported',
  webFetch: 'unsupported',
  contextWindow: 200000,
  maxOutputTokens: 'unknown',
} as const

describe('parseProviderConnection', () => {
  const LANGUAGE = {
    id: 'work-openai',
    displayName: 'Work OpenAI',
    kind: 'language',
    source: 'local',
    enabled: true,
    credential: 'absent',
    protocol: 'openai-responses',
  } as const

  it('accepts a minimal language connection', () => {
    const parsed = parseProviderConnection(LANGUAGE)
    expect(parsed).toEqual(LANGUAGE)
  })

  it('keeps the optional fields when present and omits them when not', () => {
    const withOptional = parseProviderConnection({
      ...LANGUAGE,
      baseUrl: 'https://api.openai.com/v1',
      catalogProvider: 'openai',
    })
    expect(withOptional?.baseUrl).toBe('https://api.openai.com/v1')
    expect(withOptional?.catalogProvider).toBe('openai')

    const withoutOptional = parseProviderConnection(LANGUAGE)
    expect(withoutOptional).not.toHaveProperty('baseUrl')
    expect(withoutOptional).not.toHaveProperty('catalogProvider')
  })

  it('accepts the media and retrieval variants with their own protocols', () => {
    expect(
      parseProviderConnection({
        ...LANGUAGE,
        id: 'images',
        kind: 'media',
        protocol: 'openai-images',
      }),
    ).not.toBeNull()

    expect(
      parseProviderConnection({
        ...LANGUAGE,
        id: 'search',
        kind: 'retrieval',
        protocol: 'brave',
      }),
    ).not.toBeNull()
  })

  it('refuses a protocol from the wrong kind', () => {
    expect(parseProviderConnection({ ...LANGUAGE, protocol: 'brave' })).toBeNull()
    expect(
      parseProviderConnection({ ...LANGUAGE, kind: 'media', protocol: 'anthropic-messages' }),
    ).toBeNull()
  })

  it('refuses an unknown kind, an unknown source, and an unknown credential state', () => {
    expect(parseProviderConnection({ ...LANGUAGE, kind: 'embedding' })).toBeNull()
    expect(parseProviderConnection({ ...LANGUAGE, source: 'gateway' })).toBeNull()
    expect(parseProviderConnection({ ...LANGUAGE, credential: 'sk-live-abc' })).toBeNull()
  })

  it('refuses empty strings where the harness requires content', () => {
    expect(parseProviderConnection({ ...LANGUAGE, displayName: '' })).toBeNull()
    expect(parseProviderConnection({ ...LANGUAGE, baseUrl: '' })).toBeNull()
  })

  it('refuses a missing required field rather than defaulting it', () => {
    const { enabled: _enabled, ...withoutEnabled } = LANGUAGE
    expect(parseProviderConnection(withoutEnabled)).toBeNull()
  })

  it('refuses anything that is not an object', () => {
    expect(parseProviderConnection(null)).toBeNull()
    expect(parseProviderConnection([LANGUAGE])).toBeNull()
    expect(parseProviderConnection('work-openai')).toBeNull()
  })

  it('drops every field the contract does not name', () => {
    const parsed = parseProviderConnection({
      ...LANGUAGE,
      apiKey: 'sk-CANARY-DO-NOT-PERSIST',
      secretRef: 'sk-CANARY-DO-NOT-PERSIST',
      __proto__marker: 'sk-CANARY-DO-NOT-PERSIST',
    })

    expect(parsed).not.toBeNull()
    expect(JSON.stringify(parsed)).not.toContain('sk-CANARY-DO-NOT-PERSIST')
    expect(Object.keys(parsed ?? {})).toEqual([
      'id',
      'displayName',
      'source',
      'enabled',
      'credential',
      'kind',
      'protocol',
    ])
  })
})

describe('parseModelCapability', () => {
  it('accepts the full shape', () => {
    expect(parseModelCapability(CAPABILITY)).toEqual(CAPABILITY)
  })

  it('refuses a missing capability key rather than assuming "unknown"', () => {
    const { reranking: _reranking, ...missing } = CAPABILITY
    expect(parseModelCapability(missing)).toBeNull()
  })

  it('refuses a numeric limit that is neither a number nor "unknown"', () => {
    expect(parseModelCapability({ ...CAPABILITY, contextWindow: '200000' })).toBeNull()
    expect(parseModelCapability({ ...CAPABILITY, maxOutputTokens: null })).toBeNull()
  })

  it('refuses a non-finite number', () => {
    expect(parseModelCapability({ ...CAPABILITY, contextWindow: Number.NaN })).toBeNull()
  })
})

describe('parseProviderModels', () => {
  const MODEL = {
    connectionId: 'work-openai',
    modelId: 'gpt-5',
    displayName: 'GPT-5',
    capability: CAPABILITY,
    reasoningLevels: ['minimal', 'low', 'medium', 'high'],
    shape: 'stream',
    pricing: { input: 1.25, output: 10, cacheRead: 'unknown', cacheWrite: 'unknown' },
    hidden: false,
    origin: 'catalog',
  } as const

  it('accepts an empty list', () => {
    expect(parseProviderModels([])).toEqual([])
  })

  it('accepts a well-formed list', () => {
    // `available` is absent from the wire fixture because it is optional with
    // a default: a row that predates the field was never marked, and "not
    // marked" parses as available.
    expect(parseProviderModels([MODEL])).toEqual([{ ...MODEL, available: true }])
  })

  it('reads absent reasoning levels as a model with none, and refuses a bad one', () => {
    // The field arrived after the catalog did: rows written before it are
    // models the harness knew no levels for, which is what empty says.
    const { reasoningLevels: _levels, ...without } = MODEL
    expect(parseProviderModel(without)?.reasoningLevels).toEqual([])
    expect(parseProviderModel({ ...MODEL, reasoningLevels: ['colossal'] })).toBeNull()
  })

  it('reads absent availability as available and keeps a stated false', () => {
    const { available: _available, ...without } = { ...MODEL, available: true }
    expect(parseProviderModel(without)?.available).toBe(true)
    expect(parseProviderModel({ ...MODEL, available: false })?.available).toBe(false)
  })

  it('fails the whole list when one element is wrong', () => {
    // Half a list is worse than no list: the UI would render a shorter set of
    // models with no way to know it was short.
    expect(parseProviderModels([MODEL, { ...MODEL, origin: 'imagined' }])).toBeNull()
  })

  it('refuses a list that is not a list', () => {
    expect(parseProviderModels(MODEL)).toBeNull()
    expect(parseProviderModels(null)).toBeNull()
  })
})

describe('parseProbeResult', () => {
  it('accepts a successful probe', () => {
    expect(parseProbeResult({ ok: true, reachedAt: 12, modelCount: 3, latencyMs: 40 })).toEqual({
      ok: true,
      reachedAt: 12,
      modelCount: 3,
      latencyMs: 40,
    })
  })

  it('accepts a failed probe that never got a status', () => {
    expect(parseProbeResult({ ok: false, reachedAt: 12, failure: 'No route to host.' })).toEqual({
      ok: false,
      reachedAt: 12,
      failure: 'No route to host.',
    })
  })

  it('refuses a probe with no timestamp', () => {
    expect(parseProbeResult({ ok: true })).toBeNull()
  })

  it('refuses an optional field of the wrong type instead of dropping it', () => {
    expect(parseProbeResult({ ok: true, reachedAt: 12, modelCount: 'many' })).toBeNull()
  })
})

describe('parseHarnessErrorBody', () => {
  it('reads the harness sentence and code', () => {
    expect(parseHarnessErrorBody({ error: 'Nope.', code: 'models.configuration' })).toEqual({
      error: 'Nope.',
      code: 'models.configuration',
    })
  })

  it('reads a 404 body, which carries no code', () => {
    expect(parseHarnessErrorBody({ error: 'That connection does not exist.' })).toEqual({
      error: 'That connection does not exist.',
    })
  })

  it('returns null when there is no sentence to show', () => {
    expect(parseHarnessErrorBody({ code: 'models.configuration' })).toBeNull()
    expect(parseHarnessErrorBody('gateway exploded')).toBeNull()
  })
})

describe('parseWireStreamEvent', () => {
  it('reads every variant Rust can deliver, with its resume offset', () => {
    expect(parseWireStreamEvent({ kind: 'up-to-date', offset: '4_1' })).toEqual({
      kind: 'up-to-date',
      offset: '4_1',
    })
    expect(parseWireStreamEvent({ kind: 'keep-alive', offset: '-1' })).toEqual({
      kind: 'keep-alive',
      offset: '-1',
    })
    expect(parseWireStreamEvent({ kind: 'ended', offset: '9_0' })).toEqual({
      kind: 'ended',
      offset: '9_0',
    })
    expect(
      parseWireStreamEvent({ kind: 'frame', offset: '5_0', event: null, data: '[1]' }),
    ).toEqual({ kind: 'frame', offset: '5_0', data: '[1]' })
    expect(
      parseWireStreamEvent({ kind: 'frame', offset: '5_0', event: 'presence', data: '{}' }),
    ).toEqual({ kind: 'frame', offset: '5_0', event: 'presence', data: '{}' })
  })

  it('refuses anything without the one fact every variant must carry', () => {
    // The offset is the resume contract; an event without one cannot exist.
    expect(parseWireStreamEvent({ kind: 'up-to-date' })).toBeNull()
    expect(parseWireStreamEvent({ kind: 'frame', data: 'x' })).toBeNull()
    expect(parseWireStreamEvent({ kind: 'mystery', offset: '1_0' })).toBeNull()
    expect(parseWireStreamEvent('a frame from somewhere else')).toBeNull()
  })
})

describe('readChunkFacts', () => {
  // The whole flat shape, written out once: every field the wire omits is
  // null, never invented, and a consumer can rely on that for all of them.
  const EMPTY = {
    position: null,
    messageId: null,
    submissionId: null,
    outcome: null,
    snapshot: null,
    message: null,
    model: null,
    timestamp: null,
    deltaKind: null,
    delta: null,
    toolCallId: null,
    toolName: null,
    input: null,
    output: null,
    errorText: null,
    errorName: null,
    errorType: null,
    errorMessage: null,
    usage: null,
    attempt: null,
    maxRetries: null,
    delayMs: null,
  }

  it('reads identity and content fields, leaving everything else null', () => {
    expect(
      readChunkFacts({
        type: 'message-started',
        messageId: 'm1',
        submissionId: 'sub_2',
        position: { batch: 7, index: 3 },
        timestamp: '2026-08-24T00:00:00Z',
        model: { provider: 'anthropic', id: 'claude-opus-5' },
      }),
    ).toEqual({
      ...EMPTY,
      type: 'message-started',
      position: { batch: 7, index: 3 },
      messageId: 'm1',
      submissionId: 'sub_2',
      timestamp: '2026-08-24T00:00:00Z',
      model: { provider: 'anthropic', id: 'claude-opus-5' },
    })
    expect(readChunkFacts({ type: 'submission-settled', outcome: 'aborted' })).toEqual({
      ...EMPTY,
      type: 'submission-settled',
      outcome: 'aborted',
    })
  })

  it('carries a settlement error field by field, inventing nothing it omits', () => {
    // Verbatim from a live harness: Flue serializes name, message, type and
    // an empty details. The sentence is the part worth keeping; an empty
    // string is no more a reason than an absent object is.
    expect(
      readChunkFacts({
        type: 'submission-settled',
        submissionId: 'sub_9',
        outcome: 'failed',
        error: {
          name: 'FlueError',
          message: 'direct(sub_9) failed: 429 rate limit exceeded',
          type: 'operation_failed',
          details: '',
        },
      }),
    ).toEqual({
      ...EMPTY,
      type: 'submission-settled',
      submissionId: 'sub_9',
      outcome: 'failed',
      errorName: 'FlueError',
      errorType: 'operation_failed',
      errorMessage: 'direct(sub_9) failed: 429 rate limit exceeded',
    })
    // No error object at all is still a failed settlement, with no reason.
    expect(
      readChunkFacts({ type: 'submission-settled', submissionId: 'sub_8', outcome: 'failed' }),
    ).toEqual({
      ...EMPTY,
      type: 'submission-settled',
      submissionId: 'sub_8',
      outcome: 'failed',
    })
    // An error this side cannot read means "reason present but unknown",
    // never a fabricated cause — and never dropped either.
    const unreadable = readChunkFacts({ type: 'submission-settled', outcome: 'aborted', error: 42 })
    expect(unreadable).toMatchObject({
      type: 'submission-settled',
      outcome: 'aborted',
      errorName: null,
      errorType: null,
      errorMessage: null,
    })
  })

  it('carries delta content and keeps an unread kind as null rather than dropping the chunk', () => {
    expect(
      readChunkFacts({
        type: 'message-delta',
        messageId: 'm1',
        kind: 'reasoning',
        delta: 'The',
        position: { batch: 5, index: 0 },
      }),
    ).toEqual({
      ...EMPTY,
      type: 'message-delta',
      position: { batch: 5, index: 0 },
      messageId: 'm1',
      deltaKind: 'reasoning',
      delta: 'The',
    })
    const foreign = readChunkFacts({ type: 'message-delta', kind: 'citations', delta: 'x' })
    expect(foreign).toMatchObject({ type: 'message-delta', deltaKind: null, delta: 'x' })
  })

  it('keeps tool calls and their answers apart, because the wire does', () => {
    expect(
      readChunkFacts({
        type: 'tool-input',
        messageId: 'm1',
        toolCallId: 't1',
        toolName: 'read',
        input: { path: 'package.json' },
      }),
    ).toEqual({
      ...EMPTY,
      type: 'tool-input',
      messageId: 'm1',
      toolCallId: 't1',
      toolName: 'read',
      input: { present: true, value: { path: 'package.json' } },
    })
    // The output carries no message id on the wire; correlation is by call id.
    expect(readChunkFacts({ type: 'tool-output', toolCallId: 't1', output: 'contents' })).toEqual({
      ...EMPTY,
      type: 'tool-output',
      toolCallId: 't1',
      output: { present: true, value: 'contents' },
    })
    expect(
      readChunkFacts({ type: 'tool-output-error', toolCallId: 't1', errorText: 'boom' }),
    ).toEqual({
      ...EMPTY,
      type: 'tool-output-error',
      toolCallId: 't1',
      errorText: 'boom',
    })
  })

  it('keeps unknown chunk types as facts rather than dropping the batch entry', () => {
    // A projection this side has not heard of is still a real chunk with a
    // real position; dropping it would desynchronise dedupe.
    expect(readChunkFacts({ type: 'compaction-started-v9' })).toEqual({
      ...EMPTY,
      type: 'compaction-started-v9',
    })
    expect(
      readChunkFacts({ type: 'compaction-started-v9', position: { batch: 9, index: 1 } }),
    ).toEqual({ ...EMPTY, type: 'compaction-started-v9', position: { batch: 9, index: 1 } })
  })

  it('reads a retry signal with its attempt, budget, wait, and the failed attempt sentence', () => {
    // The harness's own announcement that a transient failure is being
    // retried. Nothing here is derived on this side — every field is read
    // off the wire or left null.
    expect(
      readChunkFacts({
        type: 'submission-retrying',
        conversationId: 'conv_1',
        submissionId: 'sub_1',
        attempt: 2,
        maxRetries: 3,
        delayMs: 4100,
        error: '429 rate limit exceeded: temporarily rate-limited upstream',
        position: { batch: 7, index: 0 },
      }),
    ).toEqual({
      ...EMPTY,
      type: 'submission-retrying',
      submissionId: 'sub_1',
      errorMessage: '429 rate limit exceeded: temporarily rate-limited upstream',
      attempt: 2,
      maxRetries: 3,
      delayMs: 4100,
      position: { batch: 7, index: 0 },
    })
  })

  it('keeps a retry signal it cannot fully read as positioned identity', () => {
    // A client that has never heard of this chunk — which is every client
    // built before it existed — keeps its type and position and loses
    // nothing it could not render anyway. That is the contract this very
    // chunk relied on while landing.
    expect(
      readChunkFacts({ type: 'submission-retrying', attempt: 'two', position: { batch: 8, index: 1 } }),
    ).toEqual({ ...EMPTY, type: 'submission-retrying', position: { batch: 8, index: 1 } })
  })

  it('refuses entries with no type at all', () => {
    expect(readChunkFacts({ position: { batch: 1, index: 1 } })).toBeNull()
    expect(readChunkFacts('text')).toBeNull()
  })

  it('refuses a position that is only half a pair', () => {
    const half = readChunkFacts({ type: 'message-delta', position: { batch: 2 } })
    expect(half).not.toBeNull()
    expect(half?.position).toBeNull()
  })
})

describe('readConversationSnapshot', () => {
  const SNAPSHOT = {
    v: 1,
    conversationId: 'conv_1',
    offset: '0000000000000000_0000000000000012',
    messages: [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello', state: 'done' }],
        metadata: { timestamp: '2026-08-24T00:00:00Z' },
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'thinking', state: 'done' },
          { type: 'text', text: 'hi', state: 'done' },
          {
            type: 'dynamic-tool',
            toolCallId: 't1',
            toolName: 'read',
            state: 'output-available',
            input: { path: 'p' },
            output: 'body',
          },
        ],
        metadata: {
          usage: { input: 10, output: 4, totalTokens: 14 },
          model: { provider: 'openrouter-test', id: 'stealth/ox-alpha' },
        },
      },
    ],
    settlements: [{ submissionId: 's1', outcome: 'completed', result: { text: 'hi' } }],
  }

  it('reads the whole snapshot, including tool parts and absent optional fields', () => {
    expect(readConversationSnapshot(SNAPSHOT)).toEqual({
      version: 1,
      conversationId: 'conv_1',
      offset: '0000000000000000_0000000000000012',
      messages: [
        {
          id: 'u1',
          role: 'user',
          submissionId: null,
          parts: [{ kind: 'text', text: 'hello', state: 'done' }],
          timestamp: '2026-08-24T00:00:00Z',
          model: null,
          usage: null,
        },
        {
          id: 'a1',
          role: 'assistant',
          submissionId: null,
          parts: [
            { kind: 'reasoning', text: 'thinking', state: 'done' },
            { kind: 'text', text: 'hi', state: 'done' },
            {
              kind: 'tool',
              toolCallId: 't1',
              toolName: 'read',
              state: 'output-available',
              input: { present: true, value: { path: 'p' } },
              output: { present: true, value: 'body' },
              errorText: null,
            },
          ],
          timestamp: null,
          model: { provider: 'openrouter-test', id: 'stealth/ox-alpha' },
          usage: {
            input: 10,
            output: 4,
            cacheRead: null,
            cacheWrite: null,
            reasoning: null,
            totalTokens: 14,
          },
        },
      ],
      settlements: [
        {
          submissionId: 's1',
          outcome: 'completed',
          result: { present: true, value: { text: 'hi' } },
          error: { present: false, name: null, type: null, message: null },
        },
      ],
    })
  })

  it('refuses a snapshot it cannot fully trust, because history is the cold-start source of truth', () => {
    expect(readConversationSnapshot({ v: 1, messages: 'no' })).toBeNull()
    expect(
      readConversationSnapshot({ ...SNAPSHOT, messages: [...SNAPSHOT.messages, { id: 'broken' }] }),
    ).toBeNull()
    expect(readConversationSnapshot(null)).toBeNull()
  })

  it('reads a reset chunk through the same reader as history', () => {
    const chunk = readChunkFacts({ type: 'conversation-reset', snapshot: SNAPSHOT })
    expect(chunk).not.toBeNull()
    if (chunk?.type !== 'conversation-reset') throw new Error('expected a reset chunk')
    expect(chunk.snapshot?.messages).toHaveLength(2)
    expect(chunk.position).toBeNull()
  })
})

describe('execution mode translation', () => {
  it('round-trips every mode through the wire vocabulary', () => {
    for (const domain of ['manual', 'edits', 'auto'] as const) {
      expect(executionModeFromWire(executionModeToWire(domain))).toBe(domain)
    }
  })

  it('uses the harness names and only those', () => {
    // The submission boundary refuses `edits` and `auto` on purpose: the mode
    // is a consent, and the translation belongs to this side of the boundary.
    expect(executionModeToWire('manual')).toBe('manual')
    expect(executionModeToWire('edits')).toBe('auto-edit')
    expect(executionModeToWire('auto')).toBe('full-auto')
  })
})

describe('parsePendingApprovals', () => {
  const APPROVAL = {
    id: 'b15b4a33-6223-4359',
    createdAt: 1_000,
    request: {
      capability: {
        id: { namespace: 'native', name: 'write' },
        title: 'Write file',
        effects: ['write'],
      },
      scope: {
        agentId: 'studio',
        conversationId: 'conversation:cnv_1',
      },
      resource: 'C:\\home\\workspace\\index.html',
      scopes: [
        { id: 'this-file', label: 'Just this file', detail: 'index.html', pattern: 'C:\\home' },
      ],
    },
    decision: {
      verdict: 'ask',
      source: 'default',
      reason: 'native/write has not been approved yet.',
    },
  }

  it('accepts a row the broker stores', () => {
    const parsed = parsePendingApprovals([APPROVAL])
    expect(parsed).toHaveLength(1)
    expect(parsed?.[0]).toMatchObject({
      id: 'b15b4a33-6223-4359',
      capabilityName: 'write',
      capabilityTitle: 'Write file',
      resource: 'C:\\home\\workspace\\index.html',
      conversationId: 'conversation:cnv_1',
      source: 'default',
      reason: 'native/write has not been approved yet.',
    })
  })

  it('carries a resource that is absent, not empty', () => {
    // A harness request built with `resource: undefined` serializes with no
    // resource key at all; null on the wire reads as null here.
    const parsed = parsePendingApprovals([
      { ...APPROVAL, request: { ...APPROVAL.request, resource: undefined } },
    ])
    expect(parsed?.[0]?.resource).toBeNull()
  })

  it('refuses a row missing the fields the prompt renders', () => {
    expect(parsePendingApprovals([{ ...APPROVAL, id: '' }])).toBeNull()
    expect(parsePendingApprovals([{ ...APPROVAL, decision: undefined }])).toBeNull()
    expect(parsePendingApprovals([{ ...APPROVAL, decision: { verdict: 'ask' } }])).toBeNull()
    expect(
      parsePendingApprovals([{ ...APPROVAL, decision: { ...APPROVAL.decision, source: 'vibes' } }]),
    ).toBeNull()
    expect(parsePendingApprovals([APPROVAL, { id: 'broken' }])).toBeNull()
  })

  it('refuses a scope ladder entry that is not the shape offered', () => {
    expect(
      parsePendingApprovals([
        { ...APPROVAL, request: { ...APPROVAL.request, scopes: [{ id: 'this-file' }] } },
      ]),
    ).toBeNull()
  })
})
