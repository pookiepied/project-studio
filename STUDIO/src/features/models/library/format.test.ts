import { describe, expect, it } from 'vitest'
import { contextFull, contextHint, priceFull, priceHint, rowCapabilities } from './format'
import type { CatalogModel } from '@/domain/models/catalog'

/**
 * The library's number formatting. The row and the page print the same
 * numbers at different weights - the row compact, the page exact - and both
 * print nothing when the wire said "unknown".
 */

describe('contextHint', () => {
  it('prints thousands as k and millions as M', () => {
    expect(contextHint(200_000)).toBe('200k')
    expect(contextHint(1_000_000)).toBe('1M')
    expect(contextHint(1_048_576)).toBe('1M')
    expect(contextHint(2_500_000)).toBe('2.5M')
    expect(contextHint(10_000_000)).toBe('10M')
  })

  it('says nothing about a context the provider never described', () => {
    expect(contextHint('unknown')).toBe('')
  })
})

describe('contextFull', () => {
  it('prints the exact figure, or the dash the wire gives', () => {
    expect(contextFull(200_000)).toBe('200,000')
    expect(contextFull('unknown')).toBe('—')
  })
})

describe('priceFull', () => {
  it('prints per-million dollars to two decimals, or the dash', () => {
    expect(priceFull(3)).toBe('$3.00 / M')
    expect(priceFull(0.25)).toBe('$0.25 / M')
    expect(priceFull('unknown')).toBe('—')
  })
})

describe('priceHint', () => {
  it('pairs input against output, whole dollars whole', () => {
    expect(priceHint(3, 15)).toBe('$3 / $15')
    expect(priceHint(0.25, 1.25)).toBe('$0.25 / $1.25')
    expect(priceHint(120, 600)).toBe('$120 / $600')
  })

  it('dashes only the side the provider did not describe', () => {
    expect(priceHint(3, 'unknown')).toBe('$3 / —')
  })

  it('claims no price at all when neither side is known', () => {
    expect(priceHint('unknown', 'unknown')).toBe('')
  })
})

describe('rowCapabilities', () => {
  it('names only confirmed capabilities, in sibling-differentiating order', () => {
    expect(
      rowCapabilities(model({ toolCalling: 'supported', vision: 'supported', reasoning: 'unknown' })).map(
        (capability) => capability.id,
      ),
    ).toEqual(['tools', 'vision'])
    expect(rowCapabilities(model({ toolCalling: 'unsupported', vision: 'unsupported', reasoning: 'unsupported' }))).toEqual([])
  })
})

function model(capability: Partial<Parameters<typeof rowCapabilities>[0]['capability']>): CatalogModel {
  return {
    id: 'anthropic/claude',
    connectionId: 'c',
    modelId: 'claude',
    name: 'Claude',
    author: 'anthropic',
    connectionVendor: 'c',
    connectionName: 'c',
    reasoningLevels: [],
    contextWindow: 200_000,
    capability: {
      textGeneration: 'supported',
      streaming: 'supported',
      reasoning: 'unknown',
      toolCalling: 'unknown',
      vision: 'unknown',
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
      ...capability,
    },
    pricing: { input: 3, output: 15, cacheRead: 'unknown', cacheWrite: 'unknown' },
  }
}
