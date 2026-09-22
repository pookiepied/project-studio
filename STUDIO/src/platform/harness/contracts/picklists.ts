/**
 * The closed vocabularies of the wire, and the translations between them and
 * the domain's: kinds, protocols, statuses, reasoning levels, execution
 * modes, capability slots, and what a connection serves.
 */

import { isRecord } from '@/lib/guards'
import type { PermissionMode } from '@/domain/permissions/modes'
import type { ModelCapability } from './models'
import { oneOf } from './guards'

/** `providerKindSchema`. */
export const PROVIDER_KINDS = ['language', 'media', 'retrieval'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** `providerSourceSchema`. `local` is this machine's store; `test` is the double. */
export const PROVIDER_SOURCES = ['local', 'test'] as const
export type ProviderSource = (typeof PROVIDER_SOURCES)[number]

/** `languageProtocolSchema`. */
export const LANGUAGE_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
  'azure-openai-responses',
] as const
export type LanguageProtocol = (typeof LANGUAGE_PROTOCOLS)[number]

/** `mediaProtocolSchema`. */
export const MEDIA_PROTOCOLS = [
  'openai',
  'openrouter',
  'google',
  'elevenlabs',
  'fal',
  'deepgram',
  'fish-audio',
  'minimax',
] as const
export type MediaProtocol = (typeof MEDIA_PROTOCOLS)[number]

/** `retrievalProtocolSchema`. */
export const RETRIEVAL_PROTOCOLS = ['brave', 'tavily', 'exa', 'firecrawl', 'jina'] as const
export type RetrievalProtocol = (typeof RETRIEVAL_PROTOCOLS)[number]

/** `invocationShapeSchema`. How the harness issues a call and waits for it. */
export const INVOCATION_SHAPES = ['stream', 'sync', 'poll'] as const
export type InvocationShape = (typeof INVOCATION_SHAPES)[number]

/**
 * `credentialStatusSchema`. What is known about a key without holding it:
 * the store has one, the process inherited one, or there is none.
 */
export const CREDENTIAL_STATUSES = ['set', 'from-env', 'absent'] as const
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

/** `capabilityStateSchema` from `contracts/models.ts`. */
export const CAPABILITY_STATES = ['supported', 'unsupported', 'unknown'] as const
export type CapabilityState = (typeof CAPABILITY_STATES)[number]

/** `providerModelSchema.origin`. Why a model is in the list at all. */
export const MODEL_ORIGINS = ['catalog', 'manual', 'fetched'] as const
export type ModelOrigin = (typeof MODEL_ORIGINS)[number]

/**
 * The reasoning levels a model may support, mirrored from
 * `REASONING_LEVELS` in `STUDIO HARNESS/src/contracts/models.ts` - which is
 * itself Pi's ThinkingLevel union. "default" is deliberately not a member: it
 * is a choice the composer offers beside the levels, meaning the provider's
 * own behaviour, and it never arrives as a level.
 */
export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

/**
 * `executionModeSchema`, mirrored from `STUDIO HARNESS/src/permissions/mode.ts`.
 *
 * These are the harness's own names for the two execution modes, and the
 * only spelling every wire value is validated against: the submission body,
 * the conversation create and patch bodies, the stored column, and the record
 * the index returns. Since ADR 0057 the picker (`domain/permissions/modes.ts`)
 * speaks the same two words, so the two maps below are identities - kept,
 * because they are the one place the picker's word is turned into a wire
 * value and back, and a mode is a consent: the day the two vocabularies part
 * again, the translation is already where it has to be and nowhere else.
 */
export const EXECUTION_MODES = ['ask', 'auto'] as const
export type ExecutionModeWire = (typeof EXECUTION_MODES)[number]

export const MODE_TO_WIRE: Record<PermissionMode, ExecutionModeWire> = {
  ask: 'ask',
  auto: 'auto',
}

export const WIRE_TO_MODE: Record<ExecutionModeWire, PermissionMode> = {
  ask: 'ask',
  auto: 'auto',
}

/** The picker's word for a mode becomes the word the harness validates. */
export function executionModeToWire(mode: PermissionMode): ExecutionModeWire {
  return MODE_TO_WIRE[mode]
}

/** The wire value becomes the picker's word. */
export function executionModeFromWire(value: ExecutionModeWire): PermissionMode {
  return WIRE_TO_MODE[value]
}

/**
 * A reasoning choice as the index stores it: a level, or "default" - the
 * provider's own behaviour. Mirrored from `reasoningChoiceSchema`.
 */
export const REASONING_CHOICES = ['default', ...REASONING_LEVELS] as const
export type ReasoningChoice = (typeof REASONING_CHOICES)[number]

/** `CAPABILITY_SLOTS`. The `capability` filter `GET /models` accepts. */
export const CAPABILITY_SLOTS = [
  'textGeneration',
  'imageGeneration',
  'imageEditing',
  'videoGeneration',
  'speechGeneration',
  'transcription',
  'documentReading',
  'embeddings',
  'webSearch',
  'webFetch',
] as const
export type CapabilitySlot = (typeof CAPABILITY_SLOTS)[number]

/**
 * `connectionServesSchema` — what one connection serves, and on which wire.
 *
 * A connection is to a vendor, and one key serves any subset of the three
 * kinds: a kind is present when the connection serves it, and its value is
 * the protocol spoken for that kind. Each kind keeps its own protocol union,
 * so a retrieval wire cannot land under `language` without a type error. At
 * least one kind is always present; the parser refuses an empty map.
 */
export interface ConnectionServes {
  readonly language?: LanguageProtocol
  readonly media?: MediaProtocol
  readonly retrieval?: RetrievalProtocol
}

/**
 * `kindOfCapability` - the kind a model belongs to, read off what it can do.
 * A model carries no kind of its own: text generation is language, search
 * and fetch are retrieval, everything else that generates or transcribes is
 * media, and a model that supports nothing recognisable is language.
 */
export function kindOfCapability(capability: ModelCapability): ProviderKind {
  if (capability.textGeneration === 'supported') return 'language'
  if (capability.webSearch === 'supported' || capability.webFetch === 'supported') return 'retrieval'
  const media: readonly (keyof ModelCapability)[] = [
    'imageGeneration',
    'imageEditing',
    'videoGeneration',
    'speechGeneration',
    'transcription',
    'documentReading',
    'embeddings',
  ]
  if (media.some((slot) => capability[slot] === 'supported')) return 'media'
  return 'language'
}

/** The capability slots each kind of provider fills. */
export const SLOTS_BY_KIND: Readonly<Record<ProviderKind, readonly CapabilitySlot[]>> = {
  language: ['textGeneration'],
  media: ['imageGeneration', 'imageEditing', 'videoGeneration', 'speechGeneration', 'transcription', 'documentReading', 'embeddings'],
  retrieval: ['webSearch', 'webFetch'],
}

export function servesKindOf(connection: { readonly serves: ConnectionServes }, kind: ProviderKind): boolean {
  return connection.serves[kind] !== undefined
}

/**
 * Whether a model can do this kind of work, whatever else it also does.
 *
 * One model answers once per kind, not once in total: a joined row that both
 * chats and paints (`google/gemini-3-pro-image`, a language model and the same
 * hour an image model) has to show on both pages, and a single-kind vocabulary
 * loses it on one of them. Text remains the language question, and a model
 * that supports nothing recognisable still counts as language - the only kind
 * a hand-entered model with an unknown capability can be run as. Mirrored from
 * `capabilityServesKind` in the harness's `contracts/providers.ts`.
 */
export function capabilityServesKind(capability: ModelCapability, kind: ProviderKind): boolean {
  if (kind === 'language') return kindOfCapability(capability) === 'language'
  return SLOTS_BY_KIND[kind].some((slot) => capability[slot] === 'supported')
}

/** The kinds a connection serves, in the contract's fixed order. */
export function connectionKinds(connection: { readonly serves: ConnectionServes }): readonly ProviderKind[] {
  return PROVIDER_KINDS.filter((kind) => connection.serves[kind] !== undefined)
}

export function parseConnectionServes(value: unknown): ConnectionServes | null {
  if (!isRecord(value)) return null
  const language = value['language'] === undefined ? undefined : oneOf(LANGUAGE_PROTOCOLS, value['language'])
  const media = value['media'] === undefined ? undefined : oneOf(MEDIA_PROTOCOLS, value['media'])
  const retrieval = value['retrieval'] === undefined ? undefined : oneOf(RETRIEVAL_PROTOCOLS, value['retrieval'])
  if (language === null || media === null || retrieval === null) return null
  if (language === undefined && media === undefined && retrieval === undefined) return null
  return {
    ...(language === undefined ? {} : { language }),
    ...(media === undefined ? {} : { media }),
    ...(retrieval === undefined ? {} : { retrieval }),
  }
}
