import { describe, expect, it } from 'vitest'
import type { ModelCapability, ModelPricing, ProviderConnection, ProviderModel } from '@/platform/harness'
import { catalogFrom } from './catalog'

/**
 * The mapping from the wire to the picker's row. Nothing is invented; what
 * is pinned is the two readings the row adds - whose mark it wears and the
 * name it prints under - for the shapes the catalogs actually send.
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

function connection(id: string, catalogProvider?: string): ProviderConnection {
  return {
    id,
    displayName: id,
    source: 'local',
    enabled: true,
    serves: { language: 'openai-completions' },
    credential: 'set',
    ...(catalogProvider === undefined ? {} : { catalogProvider }),
  }
}

function wire(connectionId: string, modelId: string, displayName: string): ProviderModel {
  return {
    connectionId,
    modelId,
    displayName,
    capability: CAPABILITY,
    reasoningLevels: [],
    shape: 'stream',
    pricing: PRICING,
    hidden: false,
    origin: 'fetched',
    available: true,
    featured: false,
  }
}

describe('catalogFrom', () => {
  it("drops the author's own name from the front of a title that repeats it", () => {
    const [row] = catalogFrom(
      [connection('openrouter', 'openrouter')],
      [wire('openrouter', 'z-ai/glm-4.5', 'Z.ai: GLM 4.5')],
    )
    expect(row?.author).toBe('z-ai')
    expect(row?.name).toBe('GLM 4.5')
  })

  it("drops the prefix when it is the author's name in another spelling", () => {
    const rows = catalogFrom(
      [connection('openrouter', 'openrouter')],
      [
        wire('openrouter', 'aion-labs/aion-2.0', 'AionLabs: Aion-2.0'),
        wire('openrouter', 'x-ai/grok-4', 'SpaceXAI: Grok 4'),
        wire('openrouter', 'thinkingmachines/inkling', 'Thinking Machines: Inkling'),
      ],
    )
    expect(rows.map((row) => row.name)).toEqual(['Aion-2.0', 'Grok 4', 'Inkling'])
  })

  it('keeps a prefix that is not the author, and a title that is only the prefix', () => {
    const rows = catalogFrom(
      [connection('openrouter', 'openrouter')],
      [
        wire('openrouter', 'anthropic/claude-x', 'Preview: Claude X'),
        wire('openrouter', 'anthropic/claude-y', 'Anthropic:'),
      ],
    )
    expect(rows.map((row) => row.name)).toEqual(['Preview: Claude X', 'Anthropic:'])
  })

  it('puts the author mark on a bare id a host serves for someone else', () => {
    const [row] = catalogFrom(
      [connection('cerebras', 'cerebras')],
      [wire('cerebras', 'gpt-oss-120b', 'GPT OSS 120B')],
    )
    expect(row?.author).toBe('openai')
    expect(row?.connectionVendor).toBe('cerebras')
    expect(row?.id).toBe('cerebras/gpt-oss-120b')
  })
})
