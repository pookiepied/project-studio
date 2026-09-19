import { describe, expect, it } from 'vitest'
import type { ModelCapability, ModelPricing } from '@/platform/harness'
import type { CatalogModel } from './catalog'
import { authorOf, familyGroups, familyName } from './families'

/**
 * Whose model a row is. The author is read from three places in order of
 * trust - the id's prefix, the model's own name, the connection's vendor -
 * and the name it prints under is the vendor's own where the table knows
 * it. What is pinned here is that each source answers the case it exists
 * for, and that the fallbacks are the honest ones.
 */

describe('authorOf', () => {
  it('reads the author off a prefixed id, dropping the routing tilde', () => {
    expect(authorOf('anthropic/claude-sonnet-4', 'openrouter')).toBe('anthropic')
    // OpenRouter marks a routing variant with a tilde; it is the same author.
    expect(authorOf('~anthropic/claude-sonnet-4', 'openrouter')).toBe('anthropic')
    expect(authorOf('Meta-Llama/Llama-3.3-70B', 'together')).toBe('meta-llama')
  })

  it('recognises a bare id by the name the vendor gave the model', () => {
    // A host serving someone else's model under a bare id: the row wears the
    // author's mark, not the host's.
    expect(authorOf('gpt-oss-120b', 'cerebras')).toBe('openai')
    expect(authorOf('llama-3.3-70b-versatile', 'groq')).toBe('meta')
    expect(authorOf('glm-5.3-flash', 'devpass')).toBe('z-ai')
    expect(authorOf('Qwen3-235B', 'fireworks')).toBe('qwen')
  })

  it('falls back to the connection vendor for a name it does not know', () => {
    expect(authorOf('my-finetune-7b', 'devpass')).toBe('devpass')
    // A direct connection is its own author either way.
    expect(authorOf('gemini-2.5-pro', 'google')).toBe('google')
  })
})

describe('familyName', () => {
  it('names the vendors the table knows by their own name', () => {
    expect(familyName('anthropic')).toBe('Anthropic')
    expect(familyName('mistralai')).toBe('Mistral AI')
    expect(familyName('x-ai')).toBe('xAI')
    expect(familyName('z-ai')).toBe('Z.ai')
    expect(familyName('bytedance-seed')).toBe('ByteDance Seed')
  })

  it('falls back to the id, title-cased, for a vendor nobody mapped', () => {
    expect(familyName('the-box-next-door')).toBe('The Box Next Door')
    // A trailing "ai" is an initialism, not a syllable.
    expect(familyName('somebody-ai')).toBe('Somebody AI')
  })
})

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

function modelFor(author: string, modelId: string): CatalogModel {
  return {
    id: `openrouter/${modelId}`,
    connectionId: 'openrouter',
    modelId,
    name: modelId,
    author,
    connectionVendor: 'openrouter',
    connectionName: 'OpenRouter',
    reasoningLevels: [],
    contextWindow: 200_000,
    capability: CAPABILITY,
    pricing: PRICING,
  }
}

describe('familyGroups', () => {
  it("groups one connection's rows by author, families in name order, models numerically", () => {
    const groups = familyGroups([
      modelFor('x-ai', 'grok-4'),
      modelFor('anthropic', 'claude-10'),
      modelFor('anthropic', 'claude-9'),
      modelFor('mistralai', 'mistral-large'),
    ])
    // "Anthropic" < "Mistral AI" < "xAI" by name, though the ids sort differently.
    expect(groups.map((group) => group.author)).toEqual(['anthropic', 'mistralai', 'x-ai'])
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual(['claude-9', 'claude-10'])
  })

  it('groups nothing into no families', () => {
    expect(familyGroups([])).toEqual([])
  })
})
