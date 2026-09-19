import { describe, expect, it } from 'vitest'

import {
  executionModeFromWire,
  executionModeToWire,
  parseBackgroundJob,
  parseBackgroundJobs,
  parseFolderListing,
  parseHarnessErrorBody,
  parseMcpServer,
  parseMcpServers,
  parseSkill,
  parseSkillListing,
  parseModelCapability,
  parsePendingApprovals,
  parseProbeResult,
  parseProviderConnection,
  parseProviderModel,
  parseProviderModels,
  parseWireStreamEvent,
  readChunkFacts,
  readConversationSnapshot,
} from './index'

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
    serves: { language: 'openai-responses' },
    source: 'local',
    enabled: true,
    credential: 'absent',
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

  it('accepts a connection serving media, retrieval, or several kinds on one key', () => {
    expect(
      parseProviderConnection({
        ...LANGUAGE,
        id: 'images',
        serves: { media: 'openai' },
      }),
    ).not.toBeNull()

    expect(
      parseProviderConnection({
        ...LANGUAGE,
        id: 'search',
        serves: { retrieval: 'brave' },
      }),
    ).not.toBeNull()

    const several = parseProviderConnection({
      ...LANGUAGE,
      serves: { language: 'openai-responses', media: 'openai' },
    })
    expect(several?.serves).toEqual({ language: 'openai-responses', media: 'openai' })
  })

  it('refuses a protocol from the wrong kind, and a connection that serves nothing', () => {
    expect(parseProviderConnection({ ...LANGUAGE, serves: { language: 'brave' } })).toBeNull()
    expect(
      parseProviderConnection({ ...LANGUAGE, serves: { media: 'anthropic-messages' } }),
    ).toBeNull()
    expect(parseProviderConnection({ ...LANGUAGE, serves: {} })).toBeNull()
  })

  it('refuses an unknown kind, an unknown source, and an unknown credential state', () => {
    expect(parseProviderConnection({ ...LANGUAGE, serves: { embedding: 'x' } })).toBeNull()
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
      'serves',
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
    // `available` and `featured` are absent from the wire fixture because
    // they are optional with a default: a row that predates either field was
    // never marked, and "not marked" parses as available, not featured.
    expect(parseProviderModels([MODEL])).toEqual([{ ...MODEL, available: true, featured: false }])
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

  it('reads absent featured as not featured and keeps a stated true', () => {
    const { featured: _featured, ...without } = { ...MODEL, featured: false }
    expect(parseProviderModel(without)?.featured).toBe(false)
    expect(parseProviderModel({ ...MODEL, featured: true })?.featured).toBe(true)
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

/**
 * The folder browser's answer (plan step 6). The shape is small, but the null
 * parent is a real state - a volume root's way back out - and a parser that
 * read a missing parent as absent rather than as null would turn the top of
 * the walk into a malformed body.
 */
describe('parseFolderListing', () => {
  it('reads a listing with its directories and its parent', () => {
    expect(
      parseFolderListing({
        path: 'C:\\Users\\pooki',
        parent: 'C:\\Users',
        directories: [{ name: 'Dev Workspace', path: 'C:\\Users\\pooki\\Dev Workspace' }],
      }),
    ).toEqual({
      path: 'C:\\Users\\pooki',
      parent: 'C:\\Users',
      directories: [{ name: 'Dev Workspace', path: 'C:\\Users\\pooki\\Dev Workspace' }],
    })
  })

  it('reads a null parent as null, not as a missing field', () => {
    expect(parseFolderListing({ path: 'C:\\', parent: null, directories: [] })).toEqual({
      path: 'C:\\',
      parent: null,
      directories: [],
    })
  })

  it('refuses a listing whose directories are not entries', () => {
    expect(parseFolderListing({ path: 'C:\\', parent: null, directories: ['Dev Workspace'] })).toBeNull()
  })

  it('refuses a listing with no position', () => {
    expect(parseFolderListing({ parent: null, directories: [] })).toBeNull()
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

  it('reads Flue own nested envelope, preferring details over the class sentence', () => {
    expect(
      parseHarnessErrorBody({
        error: {
          type: 'invalid_request',
          message: 'Request is malformed.',
          details: 'Delivered messages must be { kind: "user", body: string }.',
        },
      }),
    ).toEqual({ error: 'Delivered messages must be { kind: "user", body: string }.' })
  })

  it('falls back to the nested message when details is empty or absent', () => {
    expect(
      parseHarnessErrorBody({ error: { type: 'operation_failed', message: 'The turn failed.', details: '' } }),
    ).toEqual({ error: 'The turn failed.' })
    expect(parseHarnessErrorBody({ error: { type: 'internal_error' } })).toBeNull()
  })

  it('reads a code from either shape', () => {
    expect(
      parseHarnessErrorBody({ error: { type: 'invalid_request', message: 'Bad.' }, code: 'x' }),
    ).toEqual({ error: 'Bad.', code: 'x' })
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
      // Absent on the wire from an unpatched runtime: no compactions.
      compactions: [],
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

  it('accepts the system advisory an aborted turn records, verbatim from a live 2.0 harness', () => {
    // Measured off a real harness (Phase 6): using the stop control leaves
    // history holding user, the empty assistant attempt, and this system
    // message. Refusing it made every aborted conversation's cold start
    // fail to parse at all.
    const aborted = {
      v: 1,
      conversationId: 'conv_1',
      offset: '0000000000000000_0000000000000007',
      messages: [
        {
          id: 'u1',
          role: 'user',
          submissionId: 's1',
          parts: [{ type: 'text', text: 'turn A [slow]', state: 'done' }],
        },
        { id: 'a1', role: 'assistant', submissionId: 's1', parts: [] },
        {
          id: 'entry_submission_aborted_s1',
          role: 'system',
          purpose: 'advisory',
          display: 'diagnostic',
          signal: { attributes: { submissionId: 's1', kind: 'direct', reason: 'aborted' } },
          settlement: { outcome: 'aborted' },
          parts: [{ type: 'text', text: 'Submission was aborted.', state: 'done' }],
        },
      ],
      settlements: [
        {
          submissionId: 's1',
          outcome: 'aborted',
          error: {
            name: 'FlueError',
            message: 'Submission was aborted.',
            type: 'submission_aborted',
            details: 'The operation was stopped before it produced a completed response.',
          },
        },
      ],
    }
    const parsed = readConversationSnapshot(aborted)
    expect(parsed).not.toBeNull()
    expect(parsed?.messages).toHaveLength(3)
    expect(parsed?.messages[2]?.role).toBe('system')
  })
})

describe('execution mode translation', () => {
  it('round-trips every mode through the wire vocabulary', () => {
    for (const domain of ['ask', 'auto'] as const) {
      expect(executionModeFromWire(executionModeToWire(domain))).toBe(domain)
    }
  })

  it('uses the harness names and only those', () => {
    // The two vocabularies coincide since ADR 0057; the seam is still the
    // one place a picker word becomes a wire value.
    expect(executionModeToWire('ask')).toBe('ask')
    expect(executionModeToWire('auto')).toBe('auto')
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

/**
 * The background commands, as they arrive over the wire.
 *
 * A row that does not parse is dropped rather than rendered with blank fields:
 * the panel it feeds shows a stop button per row, and a row with no id is a
 * button that cannot work.
 */
describe('reading background commands', () => {
  const row = {
    id: 'job_ab1',
    command: 'npm run dev',
    state: 'running',
    exitCode: null,
    startedAt: 10,
    endedAt: null,
    output: 'listening',
    dropped: 0,
  }

  it('reads a listing', () => {
    expect(parseBackgroundJobs({ jobs: [row] })).toEqual([row])
  })

  it('answers with nothing when the body is not a listing', () => {
    expect(parseBackgroundJobs(null)).toEqual([])
    expect(parseBackgroundJobs({})).toEqual([])
    expect(parseBackgroundJobs({ jobs: 'two' })).toEqual([])
  })

  it('drops a row with no id, and keeps the rest', () => {
    const kept = parseBackgroundJobs({ jobs: [{ ...row, id: '' }, row] })

    expect(kept.map((job) => job.id)).toEqual(['job_ab1'])
  })

  it('drops a row whose state is not one this app knows', () => {
    // A state the panel has no phrase for would render as a blank label beside
    // a command, which reads as a bug in the command rather than in the wire.
    expect(parseBackgroundJobs({ jobs: [{ ...row, state: 'zombie' }] })).toEqual([])
  })

  it('reads a single job out of a stop answer', () => {
    expect(parseBackgroundJob({ ...row, state: 'stopped', endedAt: 12 })?.state).toBe('stopped')
    expect(parseBackgroundJob(null)).toBeNull()
  })
})

/**
 * A well-formed record, as `GET /servers` answers it. The scope readings
 * below are added to it; the fields that decisions do not touch are here so
 * the tests fail the moment the contract grows a required field nobody
 * renamed.
 */
const MCP_SERVER = {
  id: 'echo-server',
  title: 'Echo server',
  description: 'Echoes the supplied text',
  provenance: 'user',
  transport: 'stdio',
  command: 'C:\tools\node.exe',
  args: ['server.js'],
  env: {},
  needsNetwork: false,
  auth: 'none',
  enabledByDefault: false,
}

describe('parseMcpServer', () => {
  it('reads a record with no scope readings, from a harness older than them', () => {
    // Absent, not defaulted: a row that cannot say what inherit resolves to
    // keeps quiet about it, because the difference between an old harness and
    // an "inherits nothing" answer is exactly the difference between unknown
    // and off.
    const record = parseMcpServer({ ...MCP_SERVER })
    expect(record).toEqual({ ...MCP_SERVER })
    expect(record?.project).toBeUndefined()
    expect(record?.conversation).toBeUndefined()
  })

  it('reads a server nobody has described, which is what the harness sends', () => {
    // The harness stores an undescribed server as the empty string and sends
    // the empty string back. Refusing it here refused the whole row, and
    // because one bad row fails the whole list, a single undescribed server
    // made the MCP screen unreadable and every save of one report failure
    // after the harness had already written it.
    const record = parseMcpServer({ ...MCP_SERVER, description: '' })
    expect(record).not.toBeNull()
    expect(record?.description).toBe('')
  })

  it('reads a whole list containing an undescribed server', () => {
    const rows = parseMcpServers([
      { ...MCP_SERVER, description: 'Img and video' },
      { ...MCP_SERVER, id: 'memory-test', description: '' },
    ])
    expect(rows).toHaveLength(2)
  })

  it('reads inherit as null, and says where the wider answer came from', () => {
    // The one test the checkbox-collapse bug fails: `decision: null` reaching
    // the row as `null`, not as `false`. Flattened here, a project whose
    // default says on would display - and behave - as switched off.
    const record = parseMcpServer({
      ...MCP_SERVER,
      project: { decision: null, resolved: true, decidedAt: 'global' },
    })
    expect(record?.project).toEqual({ decision: null, resolved: true, decidedAt: 'global' })
  })

  it('reads a decision of this scope, with the conversation reading beside it', () => {
    const record = parseMcpServer({
      ...MCP_SERVER,
      project: { decision: true, resolved: true, decidedAt: 'project' },
      conversation: { decision: false, resolved: false, decidedAt: 'conversation' },
    })
    expect(record?.project).toEqual({ decision: true, resolved: true, decidedAt: 'project' })
    expect(record?.conversation).toEqual({ decision: false, resolved: false, decidedAt: 'conversation' })
  })

  it('keeps a reading whose answer came from nothing, with no invented scope', () => {
    // Nothing anywhere decided, so the chain answers off and `decidedAt` is
    // absent. Inventing a scope here would be the lie the settings row exists
    // to prevent: there was no opinion, which is not an opinion for off.
    const record = parseMcpServer({
      ...MCP_SERVER,
      conversation: { decision: null, resolved: false },
    })
    expect(record?.conversation).toEqual({ decision: null, resolved: false })
  })

  it('refuses a malformed reading rather than rendering half of one', () => {
    expect(parseMcpServer({ ...MCP_SERVER, project: { decision: 'yes', resolved: true } })).toBeNull()
    expect(parseMcpServer({ ...MCP_SERVER, project: { decision: true } })).toBeNull()
    expect(parseMcpServer({ ...MCP_SERVER, project: { decision: null, resolved: true, decidedAt: 'village' } })).toBeNull()
  })
})

const SKILL = {
  id: 'review-pr',
  title: 'review-pr',
  description: 'Reviews a pull request.',
  provenance: 'user',
  directory: 'C:\\Users\\me\\.studio\\skills\\review-pr',
  enabledByDefault: false,
}

describe('parseSkill', () => {
  it('reads a record, and the same scope readings a server carries', () => {
    expect(parseSkill({ ...SKILL })).toEqual({ ...SKILL })
    const read = parseSkill({
      ...SKILL,
      project: { decision: null, resolved: true, decidedAt: 'global' },
    })
    expect(read?.project).toEqual({ decision: null, resolved: true, decidedAt: 'global' })
  })

  it('refuses a skill with no description, because the line is what the model reads', () => {
    expect(parseSkill({ ...SKILL, description: '' })).toBeNull()
  })

  it('reads an unknown provenance as the person\'s, never as Studio\'s', () => {
    expect(parseSkill({ ...SKILL, provenance: 'vendor' })?.provenance).toBe('user')
  })

  it('refuses a malformed reading rather than rendering half of one', () => {
    expect(parseSkill({ ...SKILL, conversation: { decision: 'yes', resolved: true } })).toBeNull()
  })

  it('reads the listing with its problems beside it, and refuses a broken problem', () => {
    const listing = parseSkillListing({
      skills: [SKILL],
      problems: [{ directory: 'C:\\skills\\bad', reason: 'missing YAML frontmatter' }],
    })
    expect(listing?.skills).toHaveLength(1)
    expect(listing?.problems).toEqual([{ directory: 'C:\\skills\\bad', reason: 'missing YAML frontmatter' }])
    expect(parseSkillListing({ skills: [SKILL], problems: [{ directory: 'x' }] })).toBeNull()
    expect(parseSkillListing({ skills: [SKILL] })).toBeNull()
  })
})
