import type { ModelCapability, ProviderConnection, ProviderModel } from '@/platform/harness'
/**
 * Well-formed harness payloads, for tests.
 *
 * Test-only, and it stays out of the app bundle by never being imported from
 * app code - there is no barrel entry for it and nothing under `features/`
 * reaches for it. It lives beside the code it describes rather than in a test
 * directory because these shapes have to move when the wire contract moves,
 * and a fixture two directories away is a fixture nobody updates.
 *
 * Every value here must satisfy the parsers in `platform/harness/contracts/`.
 * A fixture that would be rejected on the wire is a test proving nothing.
 */

export const CAPABILITY: ModelCapability = {
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
  contextWindow: 200_000,
  maxOutputTokens: 'unknown',
}

/** A connection whose vendor the app has a brand mark for. */
export const KNOWN_VENDOR: ProviderConnection = {
  id: 'work-anthropic',
  displayName: 'Work Anthropic',
  serves: { language: 'anthropic-messages' },
  source: 'local',
  baseUrl: 'https://api.anthropic.com',
  enabled: true,
  catalogProvider: 'anthropic',
  credential: 'set',
}

/**
 * A connection pointing at something the built-in catalog has never heard of.
 *
 * This is the normal case for anything created through the custom form - and
 * the reason `ProviderMark` had to stop taking a closed union (FE-05).
 */
export const UNKNOWN_VENDOR: ProviderConnection = {
  id: 'box-next-door',
  displayName: 'The box next door',
  serves: { language: 'openai-completions' },
  source: 'local',
  baseUrl: 'http://192.168.1.40:8080/v1',
  enabled: false,
  catalogProvider: 'together-ai',
  credential: 'absent',
}

export function modelFor(
  connectionId: string,
  modelId: string,
  reasoningLevels: ProviderModel['reasoningLevels'] = [],
): ProviderModel {
  return {
    connectionId,
    modelId,
    displayName: modelId,
    capability: CAPABILITY,
    reasoningLevels,
    shape: 'stream',
    pricing: { input: 'unknown', output: 'unknown', cacheRead: 'unknown', cacheWrite: 'unknown' },
    hidden: false,
    origin: 'catalog',
    available: true,
    featured: false,
  }
}
