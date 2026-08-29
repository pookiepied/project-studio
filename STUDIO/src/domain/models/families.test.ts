import { describe, expect, it } from 'vitest'
import type { ModelCapability, ModelPricing } from '@/platform/harness'
import type { CatalogModel } from './catalog'
import { connectionsOf, familyCatalog, familyName } from './families'

/**
 * The library's first axis: rows grouped by the vendor whose mark they wear.
 *
 * The grouping is the catalog's own categorization read out - `author` is
 * already on every row - so what is tested here is the reading: that families
 * come out alphabetized by their proper names, that models inside a family
 * sort numerically rather than as strings, that one family served by two
 * connections is still one family, and that a vendor the name table has
 * never heard of still gets a printable name.
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
  webSearch: 'unsupported',
  webFetch: 'unsupported',
  contextWindow: 200_000,
  maxOutputTokens: 'unknown',
}

function modelFor(author: string, modelId: string, connectionId: string): CatalogModel {
  return {
    id: `${author}/${modelId}`,
    connectionId,
    modelId,
    name: modelId,
    author,
    connectionVendor: connectionId,
    connectionName: connectionId,
    reasoningLevels: [],
    contextWindow: 200_000,
    capability: CAPABILITY,
    pricing: PRICING,
  }
}

describe('familyCatalog', () => {
  it('groups rows by the vendor whose mark they wear, across connections', () => {
    const families = familyCatalog([
      modelFor('anthropic', 'claude-a', 'work-anthropic'),
      modelFor('anthropic', 'claude-b', 'openrouter'),
      modelFor('openai', 'gpt-a', 'openrouter'),
    ])
    expect(families.map((family) => family.author)).toEqual(['anthropic', 'openai'])
    expect(families[0]?.models).toHaveLength(2)
  })

  it('orders families by their proper names, not their ids', () => {
    const families = familyCatalog([
      modelFor('openai', 'gpt-a', 'c'),
      modelFor('mistralai', 'mistral-a', 'c'),
      modelFor('x-ai', 'grok-a', 'c'),
    ])
    // "Mistral AI" < "OpenAI" < "xAI" alphabetically, though the ids would
    // sort differently.
    expect(families.map((family) => familyName(family.author))).toEqual([
      'Mistral AI',
      'OpenAI',
      'xAI',
    ])
  })

  it('sorts models numerically within a family, so 10 follows 9', () => {
    const families = familyCatalog([
      modelFor('anthropic', 'model-10', 'c'),
      modelFor('anthropic', 'model-9', 'c'),
      modelFor('anthropic', 'model-1', 'c'),
    ])
    expect(families[0]?.models.map((model) => model.modelId)).toEqual([
      'model-1',
      'model-9',
      'model-10',
    ])
  })

  it('groups an empty catalog into no families', () => {
    expect(familyCatalog([])).toEqual([])
  })
})

describe('familyName', () => {
  it('names the vendors the table knows by their own name', () => {
    expect(familyName('anthropic')).toBe('Anthropic')
    expect(familyName('mistralai')).toBe('Mistral AI')
    expect(familyName('x-ai')).toBe('xAI')
  })

  it('falls back to the id, title-cased, for a vendor nobody mapped', () => {
    expect(familyName('the-box-next-door')).toBe('The Box Next Door')
    expect(familyName('ai21')).toBe('Ai21')
  })
})

describe('connectionsOf', () => {
  it('names each serving connection once', () => {
    const families = familyCatalog([
      modelFor('anthropic', 'claude-a', 'work-anthropic'),
      modelFor('anthropic', 'claude-b', 'work-anthropic'),
      modelFor('anthropic', 'claude-c', 'openrouter'),
    ])
    const family = families[0]
    if (family === undefined) throw new Error('expected the rows to group into one family')
    expect(connectionsOf(family)).toEqual(['work-anthropic', 'openrouter'])
  })
})
