import { describe, expect, it } from 'vitest'

import {
  parseHarnessErrorBody,
  parseModelCapability,
  parseProbeResult,
  parseProviderConnection,
  parseProviderModels,
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
  videoGeneration: 'unsupported',
  speechGeneration: 'unsupported',
  transcription: 'unsupported',
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
    shape: 'stream',
    pricing: { input: 1.25, output: 10, cacheRead: 'unknown', cacheWrite: 'unknown' },
    hidden: false,
    origin: 'catalog',
  } as const

  it('accepts an empty list', () => {
    expect(parseProviderModels([])).toEqual([])
  })

  it('accepts a well-formed list', () => {
    expect(parseProviderModels([MODEL])).toEqual([MODEL])
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
