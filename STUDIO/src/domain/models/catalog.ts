import type { Model, Provider } from '@/domain/models/types'

/**
 * The built-in catalog.
 *
 * Demo data with a real shape: this is what a gateway will return, so the
 * picker is already written against the structure it will receive. Replacing
 * this file with a fetch is the whole migration.
 */

export const PROVIDERS: readonly Provider[] = [
  { id: 'anthropic', name: 'Anthropic', compatibility: 'anthropic', custom: false },
  { id: 'openai', name: 'OpenAI', compatibility: 'openai-responses', custom: false },
  { id: 'google', name: 'Google', compatibility: 'google', custom: false },
  { id: 'meta', name: 'Meta', compatibility: 'openai-chat', custom: false },
  { id: 'deepseek', name: 'DeepSeek', compatibility: 'openai-chat', custom: false },
  { id: 'mistral', name: 'Mistral', compatibility: 'openai-chat', custom: false },
]

export const MODELS: readonly Model[] = [
  {
    id: 'opus-5',
    providerId: 'anthropic',
    name: 'Opus 5',
    slug: 'claude-opus-5',
    capabilities: ['text', 'vision', 'tools', 'reasoning'],
    note: 'The most capable. Slower, and worth it on hard problems.',
    contextWindow: 200_000,
  },
  {
    id: 'sonnet-5',
    providerId: 'anthropic',
    name: 'Sonnet 5',
    slug: 'claude-sonnet-5',
    capabilities: ['text', 'vision', 'tools', 'reasoning'],
    note: 'Balanced. The everyday default.',
    contextWindow: 200_000,
  },
  {
    id: 'haiku-4-5',
    providerId: 'anthropic',
    name: 'Haiku 4.5',
    slug: 'claude-haiku-4-5',
    capabilities: ['text', 'vision', 'tools'],
    note: 'Fast and light.',
    contextWindow: 200_000,
  },
  {
    id: 'gpt-5-6',
    providerId: 'openai',
    name: 'GPT-5.6',
    slug: 'gpt-5.6',
    capabilities: ['text', 'vision', 'tools', 'reasoning'],
    note: 'Strong general reasoning.',
    contextWindow: 200_000,
  },
  {
    id: 'gpt-5-6-mini',
    providerId: 'openai',
    name: 'GPT-5.6 mini',
    slug: 'gpt-5.6-mini',
    capabilities: ['text', 'vision', 'tools'],
    note: 'Cheaper, and quick.',
    contextWindow: 200_000,
  },
  {
    id: 'gemini-3-flash',
    providerId: 'google',
    name: 'Gemini 3 Flash',
    slug: 'gemini-3-flash',
    capabilities: ['text', 'vision', 'tools'],
    note: 'Very fast, very long context.',
    contextWindow: 200_000,
  },
  {
    id: 'gemini-3-pro',
    providerId: 'google',
    name: 'Gemini 3 Pro',
    slug: 'gemini-3-pro',
    capabilities: ['text', 'vision', 'tools', 'reasoning'],
    note: 'Google at full strength.',
    contextWindow: 200_000,
  },
  {
    id: 'llama-4-maverick',
    providerId: 'meta',
    name: 'Llama 4 Maverick',
    slug: 'llama-4-maverick',
    capabilities: ['text', 'tools'],
    note: 'Open weights, run anywhere.',
    contextWindow: 200_000,
  },
  {
    id: 'deepseek-v4',
    providerId: 'deepseek',
    name: 'DeepSeek V4',
    slug: 'deepseek-v4',
    capabilities: ['text', 'tools', 'reasoning'],
    note: 'Reasoning at a low price.',
    contextWindow: 200_000,
  },
  {
    id: 'mistral-large-3',
    providerId: 'mistral',
    name: 'Mistral Large 3',
    slug: 'mistral-large-3',
    capabilities: ['text', 'tools'],
    note: 'European hosting, solid all-rounder.',
    contextWindow: 200_000,
  },
]

export const DEFAULT_MODEL_ID = 'sonnet-5'

export function findModel(id: string): Model | undefined {
  return MODELS.find((model) => model.id === id)
}

export function findProvider(id: string): Provider | undefined {
  return PROVIDERS.find((provider) => provider.id === id)
}

/** Models grouped under their provider, in catalog order. */
export function modelsByProvider(): { provider: Provider; models: Model[] }[] {
  return PROVIDERS.map((provider) => ({
    provider,
    models: MODELS.filter((model) => model.providerId === provider.id),
  })).filter((group) => group.models.length > 0)
}
