import { describe, expect, it } from 'vitest'
import type { ModelCapability, ModelPricing } from '@/platform/harness'
import type { CatalogModel } from './catalog'
import { connectionCatalog } from './connections'

/**
 * The library's first axis: rows grouped by the connection serving them.
 *
 * The grouping reads a fact every row carries for certain, so what is
 * tested is the reading: connections come out alphabetized by the names the
 * person gave them, models inside one sort numerically rather than as
 * strings, and the same model served by two connections is two rows under
 * two headings - which is the choice a person is making.
 */

const PRICING: ModelPricing = { input: 3, output: 15, cacheRead: 'unknown', cacheWrite: 'unknown' }

const CAPABILITY: ModelCapability = {
  textGeneration: 'supported',
  streaming: 'supported',
  reasoning: 'supported',
  toolCalling: 'supported',
  vision: 'unsupported',
  embeddings: 'unsupported',
  reranking: 'unsupported',
  imageGeneration: 'unsupported',
  imageEditing: 'unsupported',
  videoGeneration: 'unsupported',
  speechGeneration: 'unsupported',
  transcription: 'unsupported',
  documentReading: 'unsupported',
  webSearch: 'unsupported',
  webFetch: 'unsupported',
  contextWindow: 200_000,
  maxOutputTokens: 'unknown',
}

function modelFor(modelId: string, connectionId: string, connectionName = connectionId): CatalogModel {
  return {
    id: `${connectionId}/${modelId}`,
    connectionId,
    modelId,
    name: modelId,
    author: 'openai',
    connectionVendor: connectionId,
    connectionName,
    reasoningLevels: [],
    contextWindow: 200_000,
    capability: CAPABILITY,
    pricing: PRICING,
  }
}

describe('connectionCatalog', () => {
  it('groups rows under the connection serving them, the same model twice when two do', () => {
    const connections = connectionCatalog([
      modelFor('gpt-oss-120b', 'cerebras', 'Cerebras'),
      modelFor('gpt-oss-120b', 'openrouter', 'OpenRouter'),
      modelFor('gpt-5', 'openrouter', 'OpenRouter'),
    ])
    expect(connections.map((connection) => connection.id)).toEqual(['cerebras', 'openrouter'])
    expect(connections[1]?.models.map((model) => model.modelId)).toEqual(['gpt-5', 'gpt-oss-120b'])
  })

  it('orders connections by the names the person gave them', () => {
    const connections = connectionCatalog([
      modelFor('a', 'c1', 'Work OpenAI'),
      modelFor('a', 'c2', 'Cerebras'),
      modelFor('a', 'c3', 'openrouter'),
    ])
    expect(connections.map((connection) => connection.name)).toEqual(['Cerebras', 'openrouter', 'Work OpenAI'])
  })

  it('sorts models numerically within a connection, so 10 follows 9', () => {
    const connections = connectionCatalog([
      modelFor('model-10', 'c'),
      modelFor('model-9', 'c'),
      modelFor('model-1', 'c'),
    ])
    expect(connections[0]?.models.map((model) => model.modelId)).toEqual(['model-1', 'model-9', 'model-10'])
  })

  it('carries the connection vendor, so the heading can wear its mark', () => {
    expect(connectionCatalog([modelFor('a', 'openrouter')])[0]?.vendor).toBe('openrouter')
  })

  it('groups an empty catalog into no connections', () => {
    expect(connectionCatalog([])).toEqual([])
  })
})
