/**
 * The harness wire contract, mirrored by hand.
 *
 * Source of truth: `STUDIO HARNESS/src/contracts/providers.ts` and
 * `STUDIO HARNESS/src/contracts/models.ts`. Over there the shapes are valibot
 * schemas and the types are inferred from them; over here they are written
 * out, because STUDIO has no schema library and adding one to a desktop
 * bundle to re-describe eleven objects is not a trade worth making. That makes
 * this file a hand-maintained mirror: when the harness contract changes, this
 * file does not notice, and nothing in either build will tell you. Update it
 * in the same change, or the parsers below will start rejecting responses that
 * are perfectly valid — which is the failure mode this design chooses, since
 * a rejection is visible and a silent misread is not.
 *
 * These are WIRE types. They are not view types. `src/domain/models/types.ts`
 * keeps its own `Provider` and `Model` for the offline catalog, and the two
 * deliberately disagree — `Provider` is `{id, name, compatibility, custom}`,
 * a `ProviderConnection` is a different thing with a different lifecycle.
 * Do not merge them and do not import this file into `domain/`. Mapping
 * happens once, at the UI boundary, in whichever component renders both.
 * (Audit finding FE-05.)
 *
 * The rule the whole design rests on: a `ProviderConnection` NEVER carries an
 * API key, in either direction. It carries a `CredentialStatus` and nothing
 * more. A key travels only in the body of a create or update request, where
 * the harness strips it into the OS credential store before the record exists
 * (`STUDIO HARNESS/src/transport/http/routes/providers.ts:36-60`). Every
 * parser below therefore builds a fresh object out of named fields rather than
 * narrowing the response in place, so a response body that carries an `apiKey`
 * cannot smuggle it into a parsed value.
 *
 * Every parser returns `null` rather than throwing. A response that does not
 * match the contract is a failure the client turns into an error case, not an
 * exception the UI has to catch.
 */

import type { PermissionMode } from '@/domain/permissions/modes'
import type { ArtifactStatus } from '@/domain/artifacts/types'
import { isRecord } from '@/lib/guards'

/* -------------------------------------------------------------------------- */
/* Primitive guards                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Membership as a narrowing, without a cast.
 *
 * Comparing each allowed member against the value means the returned item is
 * already typed as the member — the alternative, `allowed.includes(value)`
 * followed by `value as T`, is the cast this codebase does not take.
 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  for (const item of allowed) if (item === value) return item
  return null
}

/** A non-empty string, which is what every `minLength(1)` on the harness means. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** An optional non-empty string: absent is fine, present but wrong is not. */
function optionalText(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The harness writes an undescribed number as the literal "unknown". */
function numberOrUnknown(value: unknown): number | 'unknown' | null {
  if (value === 'unknown') return 'unknown'
  return finiteNumber(value)
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Maps a parser over an array, failing the whole list if any element fails. */
function listOf<T>(parse: (value: unknown) => T | null, value: unknown): readonly T[] | null {
  if (!Array.isArray(value)) return null
  const out: T[] = []
  for (const item of value) {
    const parsed = parse(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Picklists                                                                   */
/* -------------------------------------------------------------------------- */

/** `providerKindSchema`. */
const PROVIDER_KINDS = ['language', 'media', 'retrieval'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** `providerSourceSchema`. `local` is this machine's store; `test` is the double. */
const PROVIDER_SOURCES = ['local', 'test'] as const
type ProviderSource = (typeof PROVIDER_SOURCES)[number]

/** `languageProtocolSchema`. */
const LANGUAGE_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
  'azure-openai-responses',
] as const
export type LanguageProtocol = (typeof LANGUAGE_PROTOCOLS)[number]

/** `mediaProtocolSchema`. */
const MEDIA_PROTOCOLS = [
  'openai',
  'openrouter',
  'google',
  'elevenlabs',
  'fal',
  'deepgram',
  'fish-audio',
  'minimax',
] as const
type MediaProtocol = (typeof MEDIA_PROTOCOLS)[number]

/** `retrievalProtocolSchema`. */
const RETRIEVAL_PROTOCOLS = ['brave', 'tavily', 'exa', 'firecrawl', 'jina'] as const
type RetrievalProtocol = (typeof RETRIEVAL_PROTOCOLS)[number]

/** `invocationShapeSchema`. How the harness issues a call and waits for it. */
const INVOCATION_SHAPES = ['stream', 'sync', 'poll'] as const
type InvocationShape = (typeof INVOCATION_SHAPES)[number]

/**
 * `credentialStatusSchema`. What is known about a key without holding it:
 * the store has one, the process inherited one, or there is none.
 */
const CREDENTIAL_STATUSES = ['set', 'from-env', 'absent'] as const
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

/** `capabilityStateSchema` from `contracts/models.ts`. */
const CAPABILITY_STATES = ['supported', 'unsupported', 'unknown'] as const
export type CapabilityState = (typeof CAPABILITY_STATES)[number]

/** `providerModelSchema.origin`. Why a model is in the list at all. */
const MODEL_ORIGINS = ['catalog', 'manual', 'fetched'] as const
type ModelOrigin = (typeof MODEL_ORIGINS)[number]

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
 * These are the harness's own names for the three execution modes, and the
 * only spelling every wire value is validated against: the submission body,
 * the conversation create and patch bodies, the stored column, and the record
 * the index returns. The frontend's picker vocabulary (`manual` / `edits` /
 * `auto`, in `domain/permissions/modes.ts`) is deliberately a different set -
 * the mode is a consent, and the harness refuses to translate one name into
 * another on the user's behalf, so the translation happens here, on this side
 * of the boundary, and nowhere else.
 */
const EXECUTION_MODES = ['manual', 'auto-edit', 'full-auto'] as const
export type ExecutionModeWire = (typeof EXECUTION_MODES)[number]

const MODE_TO_WIRE: Record<PermissionMode, ExecutionModeWire> = {
  manual: 'manual',
  edits: 'auto-edit',
  auto: 'full-auto',
}

const WIRE_TO_MODE: Record<ExecutionModeWire, PermissionMode> = {
  manual: 'manual',
  'auto-edit': 'edits',
  'full-auto': 'auto',
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
const REASONING_CHOICES = ['default', ...REASONING_LEVELS] as const
type ReasoningChoice = (typeof REASONING_CHOICES)[number]

/** `CAPABILITY_SLOTS`. The `capability` filter `GET /models` accepts. */
export const CAPABILITY_SLOTS = [
  'textGeneration',
  'imageGeneration',
  'imageEditing',
  'videoGeneration',
  'speechGeneration',
  'transcription',
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
function kindOfCapability(capability: ModelCapability): ProviderKind {
  if (capability.textGeneration === 'supported') return 'language'
  if (capability.webSearch === 'supported' || capability.webFetch === 'supported') return 'retrieval'
  const media: readonly (keyof ModelCapability)[] = [
    'imageGeneration',
    'imageEditing',
    'videoGeneration',
    'speechGeneration',
    'transcription',
    'embeddings',
  ]
  if (media.some((slot) => capability[slot] === 'supported')) return 'media'
  return 'language'
}

/** The capability slots each kind of provider fills. */
export const SLOTS_BY_KIND: Readonly<Record<ProviderKind, readonly CapabilitySlot[]>> = {
  language: ['textGeneration'],
  media: ['imageGeneration', 'imageEditing', 'videoGeneration', 'speechGeneration', 'transcription', 'embeddings'],
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

function parseConnectionServes(value: unknown): ConnectionServes | null {
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

/* -------------------------------------------------------------------------- */
/* Connections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `providerConnectionSchema`.
 *
 * Fields are readonly here even though the harness's inferred types are not:
 * on this side a parsed connection is a value that came off the wire, and
 * nothing in the UI has any business writing to it.
 */
export interface ProviderConnection {
  /** Slug-shaped and stable: lowercase, digits, single hyphens. */
  readonly id: string
  readonly displayName: string
  readonly source: ProviderSource
  readonly baseUrl?: string
  readonly enabled: boolean
  /**
   * The vendor whose built-in model list applies, if the catalog knows it.
   * Deliberately not the same field as `id`: `id` is the user's name for this
   * connection, so two OpenAI accounts can coexist. Absent means a vendor the
   * catalog has never heard of — the normal case for a self-hosted endpoint.
   */
  readonly catalogProvider?: string
  /** Whether a key exists. Never the key. */
  readonly credential: CredentialStatus
  readonly serves: ConnectionServes
}

/**
 * A connection as the caller supplies it: everything but `credential`, plus an
 * optional key that exists for exactly the length of one request. `apiKey` is
 * the only place in this entire module where a secret appears, and it appears
 * only on the way out.
 */
export type ProviderConnectionDraft = Omit<ProviderConnection, 'credential'> & {
  readonly apiKey?: string
}

/**
 * What one patch may say about the kinds a connection serves: a protocol
 * adds or re-wires the kind, `null` removes it, absent leaves it alone.
 */
interface ConnectionServesPatch {
  readonly language?: LanguageProtocol | null
  readonly media?: MediaProtocol | null
  readonly retrieval?: RetrievalProtocol | null
}

/**
 * `ProviderConnectionPatch`. `id` is absent on purpose: changing it makes a
 * different connection while models, defaults and stored credentials still
 * point at the old one. The kinds served may change, because a key that
 * served chat yesterday serves images today without becoming a different
 * account.
 *
 * `baseUrl: null` clears the override; `baseUrl` absent leaves it alone. The
 * distinction is load-bearing — without the explicit clear, a base URL once
 * set could only be reassigned, never returned to the protocol default.
 */
export interface ProviderConnectionPatch {
  readonly displayName?: string
  readonly baseUrl?: string | null
  readonly enabled?: boolean
  readonly serves?: ConnectionServesPatch
  readonly apiKey?: string
}

/* -------------------------------------------------------------------------- */
/* Models                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `ModelCapability`. "unknown" is an undescribed dimension, distinct from a
 * confirmed "unsupported" — and distinct from 0 for the two numbers.
 */
export interface ModelCapability {
  readonly textGeneration: CapabilityState
  readonly streaming: CapabilityState
  readonly reasoning: CapabilityState
  readonly toolCalling: CapabilityState
  readonly vision: CapabilityState
  readonly embeddings: CapabilityState
  readonly reranking: CapabilityState
  readonly imageGeneration: CapabilityState
  /** Producing a new image guided by one the user supplies. */
  readonly imageEditing: CapabilityState
  readonly videoGeneration: CapabilityState
  readonly speechGeneration: CapabilityState
  readonly transcription: CapabilityState
  /** Retrieving web results for a query. */
  readonly webSearch: CapabilityState
  /** Retrieving one named page. */
  readonly webFetch: CapabilityState
  readonly contextWindow: number | 'unknown'
  readonly maxOutputTokens: number | 'unknown'
}

/**
 * The fourteen state-valued keys, listed once so the parser cannot drift from
 * the interface: a name that is not a capability key fails to compile.
 */
const CAPABILITY_STATE_KEYS = [
  'textGeneration',
  'streaming',
  'reasoning',
  'toolCalling',
  'vision',
  'embeddings',
  'reranking',
  'imageGeneration',
  'imageEditing',
  'videoGeneration',
  'speechGeneration',
  'transcription',
  'webSearch',
  'webFetch',
] as const satisfies readonly (keyof ModelCapability)[]

/** `modelPricingSchema`. USD per million tokens; "unknown" is not zero. */
export interface ModelPricing {
  readonly input: number | 'unknown'
  readonly output: number | 'unknown'
  readonly cacheRead: number | 'unknown'
  readonly cacheWrite: number | 'unknown'
}

/** `providerModelSchema` — one element of what `GET /models` returns. */
export interface ProviderModel {
  readonly connectionId: string
  /** Exactly as the provider names it, so a call needs no translation. */
  readonly modelId: string
  readonly displayName: string
  readonly capability: ModelCapability
  /**
   * The levels this one model can be asked for, from Pi's own record. Empty
   * for a model that cannot reason, which is what makes the composer's
   * reasoning control absent rather than inert. "default" is never here; the
   * composer offers it itself.
   */
  readonly reasoningLevels: readonly ReasoningLevel[]
  readonly shape: InvocationShape
  readonly pricing: ModelPricing
  /** Hidden from pickers without being deleted. */
  readonly hidden: boolean
  readonly origin: ModelOrigin
  /**
   * Whether the provider itself still offers this model, as far as its last
   * probe showed. Absent on old rows parses as true: nothing was known, and
   * nothing should be marked.
   */
  readonly available: boolean
  /**
   * Whether Studio recommends this model for what it does: the featured
   * shelf, the few the person should reach for before reading two hundred
   * ids. A word of the declared catalog, carried beside the live list it
   * floats above; a model the vendor lists live never features by itself.
   * Absent on old rows parses as false, which is what they were.
   */
  readonly featured: boolean
}

/**
 * One entry of the provider library: a vendor any of the three catalogs can
 * name, with the capability slots it actually serves.
 */
export interface LibraryProvider {
  readonly id: string
  readonly displayName: string
  /** Every kind this vendor serves on one key; a connection made from the entry serves all of them. */
  readonly serves: ConnectionServes
  readonly baseUrl?: string
  readonly capabilities: readonly CapabilitySlot[]
  readonly modelCount: number
}

/* -------------------------------------------------------------------------- */
/* Probe                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `probeResultSchema`. `ok` is the bit the UI branches on.
 *
 * `modelCount` is present only when the probe could enumerate and `failure`
 * only when it could not — never both as a substitute, so an unreachable
 * provider is never misread as "zero models". `status` is absent when the
 * attempt never produced an HTTP response (DNS refusal, timeout) and
 * `latencyMs` is absent when it never left the process.
 */
export interface ProbeResult {
  readonly ok: boolean
  readonly reachedAt: number
  readonly modelCount?: number
  readonly failure?: string
  readonly status?: number
  readonly latencyMs?: number
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/** `modelReferenceSlotSchema` - one default, naming a model by its connection. */
export interface ModelReferenceSlot {
  readonly connectionId: string
  readonly modelId: string
}

/**
 * `defaultSelectionSchema` - the user's chosen defaults, per capability slot.
 * Only the slots actually set appear, which is the contract's own partialness:
 * most users set one or two and leave the rest to the harness.
 */
export type DefaultSelection = Partial<Record<CapabilitySlot, ModelReferenceSlot>>

export function parseProviderDefaults(value: unknown): DefaultSelection | null {
  if (!isRecord(value)) return null
  const selection: DefaultSelection = {}
  for (const slot of CAPABILITY_SLOTS) {
    const raw = value[slot]
    if (raw === undefined) continue
    if (!isRecord(raw)) return null
    const connectionId = text(raw['connectionId'])
    const modelId = text(raw['modelId'])
    if (connectionId === null || modelId === null) return null
    selection[slot] = { connectionId, modelId }
  }
  return selection
}

/* -------------------------------------------------------------------------- */
/* Error body                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the harness sends with a failure. Two shapes share this reader:
 *
 * - OUR refusals: `{ error, code? }` from `failure()` in the provider routes,
 *   from the admission middleware, and from the turn-settings middleware -
 *   a flat sentence, `code` present when the route names a class.
 * - Flue's own refusals: the nested envelope `{ error: { type, message,
 *   details, ref? } }`, where `message` is the class sentence ("Request is
 *   malformed.") and `details` is the reason a person can act on. One of the
 *   two is always present on a Flue-authored refusal; `ref` is a server-log
 *   correlation id and is deliberately not carried.
 *
 * `error` is always the sentence to show a person: the flat shape's own line,
 * or the nested envelope's `details` falling back to `message`. A 400 that
 * used to render as "the harness answered 400 with no explanation" now names
 * what was wrong.
 */
export interface HarnessErrorBody {
  readonly error: string
  readonly code?: string
}

/* -------------------------------------------------------------------------- */
/* Parsers                                                                     */
/* -------------------------------------------------------------------------- */

export function parseProviderConnection(value: unknown): ProviderConnection | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const displayName = text(value['displayName'])
  const source = oneOf(PROVIDER_SOURCES, value['source'])
  const enabled = flag(value['enabled'])
  const credential = oneOf(CREDENTIAL_STATUSES, value['credential'])
  const baseUrl = optionalText(value['baseUrl'])
  const catalogProvider = optionalText(value['catalogProvider'])

  if (
    id === null ||
    displayName === null ||
    source === null ||
    enabled === null ||
    credential === null ||
    !baseUrl.ok ||
    !catalogProvider.ok
  ) {
    return null
  }

  // Rebuilt field by field, never spread from the response. This is what makes
  // an `apiKey` in the body unable to reach a parsed connection.
  const base = {
    id,
    displayName,
    source,
    enabled,
    credential,
    ...(baseUrl.value === undefined ? {} : { baseUrl: baseUrl.value }),
    ...(catalogProvider.value === undefined
      ? {}
      : { catalogProvider: catalogProvider.value }),
  }

  const serves = parseConnectionServes(value['serves'])
  return serves === null ? null : { ...base, serves }
}

export function parseProviderConnections(
  value: unknown,
): readonly ProviderConnection[] | null {
  return listOf(parseProviderConnection, value)
}

export function parseModelCapability(value: unknown): ModelCapability | null {
  if (!isRecord(value)) return null

  const contextWindow = numberOrUnknown(value['contextWindow'])
  const maxOutputTokens = numberOrUnknown(value['maxOutputTokens'])
  if (contextWindow === null || maxOutputTokens === null) return null

  const states: Partial<Record<(typeof CAPABILITY_STATE_KEYS)[number], CapabilityState>> = {}
  for (const key of CAPABILITY_STATE_KEYS) {
    const state = oneOf(CAPABILITY_STATES, value[key])
    if (state === null) return null
    states[key] = state
  }

  // Read back by name so the result satisfies the interface without a cast.
  // The loop above has already proved every one of them is present; this is
  // the compiler being shown that, not a second check.
  const {
    textGeneration,
    streaming,
    reasoning,
    toolCalling,
    vision,
    embeddings,
    reranking,
    imageGeneration,
    imageEditing,
    videoGeneration,
    speechGeneration,
    transcription,
    webSearch,
    webFetch,
  } = states
  if (
    textGeneration === undefined ||
    streaming === undefined ||
    reasoning === undefined ||
    toolCalling === undefined ||
    vision === undefined ||
    embeddings === undefined ||
    reranking === undefined ||
    imageGeneration === undefined ||
    imageEditing === undefined ||
    videoGeneration === undefined ||
    speechGeneration === undefined ||
    transcription === undefined ||
    webSearch === undefined ||
    webFetch === undefined
  ) {
    return null
  }

  return {
    textGeneration,
    streaming,
    reasoning,
    toolCalling,
    vision,
    embeddings,
    reranking,
    imageGeneration,
    imageEditing,
    videoGeneration,
    speechGeneration,
    transcription,
    webSearch,
    webFetch,
    contextWindow,
    maxOutputTokens,
  }
}

function parseModelPricing(value: unknown): ModelPricing | null {
  if (!isRecord(value)) return null
  const input = numberOrUnknown(value['input'])
  const output = numberOrUnknown(value['output'])
  const cacheRead = numberOrUnknown(value['cacheRead'])
  const cacheWrite = numberOrUnknown(value['cacheWrite'])
  if (input === null || output === null || cacheRead === null || cacheWrite === null) {
    return null
  }
  return { input, output, cacheRead, cacheWrite }
}

function parseReasoningLevels(value: unknown): readonly ReasoningLevel[] | null {
  // Absent parses as empty: records written before this field existed are
  // models the harness knew no levels for, which is what empty says.
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const levels: ReasoningLevel[] = []
  for (const item of value) {
    const level = oneOf(REASONING_LEVELS, item)
    if (level === null) return null
    levels.push(level)
  }
  return levels
}

export function parseProviderModel(value: unknown): ProviderModel | null {
  if (!isRecord(value)) return null

  const connectionId = text(value['connectionId'])
  const modelId = text(value['modelId'])
  const displayName = text(value['displayName'])
  const capability = parseModelCapability(value['capability'])
  const reasoningLevels = parseReasoningLevels(value['reasoningLevels'])
  const shape = oneOf(INVOCATION_SHAPES, value['shape'])
  const pricing = parseModelPricing(value['pricing'])
  const hidden = flag(value['hidden'])
  const origin = oneOf(MODEL_ORIGINS, value['origin'])
  // Absent parses as available: rows written before the field existed were
  // never marked, and a missing mark must not read as a bad mark.
  const available = value['available'] === undefined ? true : flag(value['available'])
  // Absent parses as not featured, which is what every row written before
  // this field existed was.
  const featured = value['featured'] === undefined ? false : flag(value['featured'])

  if (
    connectionId === null ||
    modelId === null ||
    displayName === null ||
    capability === null ||
    reasoningLevels === null ||
    shape === null ||
    pricing === null ||
    hidden === null ||
    origin === null ||
    available === null ||
    featured === null
  ) {
    return null
  }

  return {
    connectionId,
    modelId,
    displayName,
    capability,
    reasoningLevels,
    shape,
    pricing,
    hidden,
    origin,
    available,
    featured,
  }
}

export function parseProviderModels(value: unknown): readonly ProviderModel[] | null {
  return listOf(parseProviderModel, value)
}

function parseLibraryProvider(value: unknown): LibraryProvider | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const displayName = text(value['displayName'])
  const serves = parseConnectionServes(value['serves'])
  const baseUrl = optionalText(value['baseUrl'])
  const capabilities = listOf((slot: unknown) => oneOf(CAPABILITY_SLOTS, slot), value['capabilities'])
  const modelCount = typeof value['modelCount'] === 'number' ? value['modelCount'] : null

  if (
    id === null ||
    displayName === null ||
    serves === null ||
    capabilities === null ||
    modelCount === null ||
    !baseUrl.ok
  ) {
    return null
  }

  return {
    id,
    displayName,
    serves,
    capabilities,
    modelCount,
    ...(baseUrl.value === undefined ? {} : { baseUrl: baseUrl.value }),
  }
}

export function parseLibraryProviders(value: unknown): readonly LibraryProvider[] | null {
  return listOf(parseLibraryProvider, value)
}

/**
 * `GET /api/providers/icons/:id` — one vendor's real logo as SVG text.
 * Absence is the ordinary answer and travels as a 404, never as a guess.
 */
export interface ProviderIcon {
  readonly svg: string
}

export function parseProviderIcon(value: unknown): ProviderIcon | null {
  if (!isRecord(value)) return null
  const svg = text(value['svg'])
  if (svg === null || svg.length === 0) return null
  return { svg }
}

export function parseProbeResult(value: unknown): ProbeResult | null {
  if (!isRecord(value)) return null

  const ok = flag(value['ok'])
  const reachedAt = finiteNumber(value['reachedAt'])
  if (ok === null || reachedAt === null) return null

  const rawModelCount = value['modelCount']
  const rawStatus = value['status']
  const rawLatency = value['latencyMs']

  const modelCount = rawModelCount === undefined ? undefined : finiteNumber(rawModelCount)
  const status = rawStatus === undefined ? undefined : finiteNumber(rawStatus)
  const latencyMs = rawLatency === undefined ? undefined : finiteNumber(rawLatency)
  const failure = optionalText(value['failure'])

  if (modelCount === null || status === null || latencyMs === null || !failure.ok) return null

  return {
    ok,
    reachedAt,
    ...(modelCount === undefined ? {} : { modelCount }),
    ...(failure.value === undefined ? {} : { failure: failure.value }),
    ...(status === undefined ? {} : { status }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
  }
}

/**
 * The harness's failure body.
 *
 * Unlike the parsers above this one is allowed to fail softly: a body that
 * does not match still arrived with a status code the client must report, so
 * an unreadable error yields `null` and the caller substitutes a message of
 * its own rather than losing the failure entirely.
 */
export function parseHarnessErrorBody(value: unknown): HarnessErrorBody | null {
  if (!isRecord(value)) return null
  const code = optionalText(value['code'])
  const withCode = (error: string): HarnessErrorBody =>
    code.ok && code.value !== undefined ? { error, code: code.value } : { error }
  // Our flat shape first: `error` is the sentence itself.
  const flat = text(value['error'])
  if (flat !== null) return withCode(flat)
  // Flue's nested envelope: the sentence lives inside the error object, and
  // the specific reason (`details`) outranks the class sentence (`message`)
  // because "Request is malformed." is not something a person can act on.
  const nested = value['error']
  if (!isRecord(nested)) return null
  const sentence = text(nested['details']) ?? text(nested['message'])
  if (sentence === null) return null
  return withCode(sentence)
}

/* -------------------------------------------------------------------------- */
/* The conversation index                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Mirrored from `STUDIO HARNESS/src/contracts/conversations.ts`. This is the
 * INDEX, not a transcript: identity, title, filing and flags, and never one
 * word of what was said. Flue's stream at `agents/studio/<id>` owns the words,
 * and reading them back is `useConversation`'s job above.
 *
 * Like every contract here these are wire types; the sidebar's `Conversation`
 * lives in `domain/session/types.ts` and mapping happens once at the store.
 */

export interface ConversationRecord {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
  /** A person named this; automatic titling has stopped for it. */
  readonly titleManual: boolean
  readonly pinned: boolean
  readonly archived: boolean
  /** Which model the conversation is held with, in the runtime's own vocabulary; null for the default alias. */
  readonly modelId: string | null
  /** The reasoning choice it is held with; null is the same state as "default". */
  readonly reasoningLevel: ReasoningChoice | null
  /**
   * The execution mode the conversation is held with, in the harness's own
   * vocabulary. Never null on the wire: the absence of a stored answer IS
   * Manual, and the store resolves that before the record leaves
   * (`STUDIO HARNESS/src/conversations/store.ts`), so a fourth "unset" state
   * cannot reach this side and be guessed at.
   */
  readonly permissionMode: ExecutionModeWire
  readonly createdAt: number
  readonly lastTurnAt: number
}

/** The marks a project may wear; mirrored from `projectIconSchema`. */
const PROJECT_ICON_KEYS = [
  'arc',
  'stack',
  'grid',
  'ring',
  'wave',
  'burst',
  'prism',
  'diamond',
] as const

type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number]

interface ProjectFolderRecord {
  readonly id: string
  readonly name: string
  readonly path: string
}

export interface ProjectRecord {
  readonly id: string
  readonly name: string
  /** Membership, not free text: oneOf(PROJECT_ICON_KEYS) proved it below. */
  readonly icon: ProjectIconKey
  readonly description: string
  readonly folders: readonly ProjectFolderRecord[]
  readonly createdAt: number
}

function nullableText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

/**
 * A nullable text field the wire may drop entirely. `JSON.stringify` never
 * carries an `undefined`, so a request the harness built with `resource:
 * undefined` arrives with no `resource` key at all - and "no key" is the
 * same fact as null here, not a contract break.
 */
function nullableTextOrAbsent(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null }
  return nullableText(value)
}

function nullableChoice(
  value: unknown,
): { ok: true; value: ReasoningChoice | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = oneOf(REASONING_CHOICES, value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

export function parseConversationRecord(value: unknown): ConversationRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const title = nullableText(value['title'])
  const projectId = nullableText(value['projectId'])
  const titleManual = flag(value['titleManual'])
  const pinned = flag(value['pinned'])
  const archived = flag(value['archived'])
  const modelId = nullableText(value['modelId'])
  const reasoningLevel = nullableChoice(value['reasoningLevel'])
  const permissionMode = oneOf(EXECUTION_MODES, value['permissionMode'])
  const createdAt = finiteNumber(value['createdAt'])
  const lastTurnAt = finiteNumber(value['lastTurnAt'])

  if (
    id === null ||
    !title.ok ||
    !projectId.ok ||
    titleManual === null ||
    pinned === null ||
    archived === null ||
    !modelId.ok ||
    !reasoningLevel.ok ||
    permissionMode === null ||
    createdAt === null ||
    lastTurnAt === null
  ) {
    return null
  }

  // Field by field, like every other record here: nothing un-named in a
  // response body can reach the sidebar through this parser.
  return {
    id,
    title: title.value,
    projectId: projectId.value,
    titleManual,
    pinned,
    archived,
    modelId: modelId.value,
    reasoningLevel: reasoningLevel.value,
    permissionMode,
    createdAt,
    lastTurnAt,
  }
}

export function parseConversationRecords(value: unknown): readonly ConversationRecord[] | null {
  return listOf(parseConversationRecord, value)
}

function parseProjectFolder(value: unknown): ProjectFolderRecord | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const name = text(value['name'])
  const path = text(value['path'])
  if (id === null || name === null || path === null) return null
  return { id, name, path }
}

export function parseProjectRecord(value: unknown): ProjectRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const name = text(value['name'])
  const icon = oneOf(PROJECT_ICON_KEYS, value['icon'])
  const folders = listOf(parseProjectFolder, value['folders'])
  const createdAt = finiteNumber(value['createdAt'])

  // A description differs from every other text field here: empty is a real
  // stored value ("a project with no description yet"), and the column is NOT
  // NULL at the other end, so a plain string is required - null is a drift.
  const rawDescription = value['description']
  if (typeof rawDescription !== 'string') return null

  if (
    id === null ||
    name === null ||
    icon === null ||
    folders === null ||
    createdAt === null
  ) {
    return null
  }

  return {
    id,
    name,
    icon,
    description: rawDescription,
    folders,
    createdAt,
  }
}

export function parseProjectRecords(value: unknown): readonly ProjectRecord[] | null {
  return listOf(parseProjectRecord, value)
}

/* -------------------------------------------------------------------------- */
/* Index mutations                                                             */
/* -------------------------------------------------------------------------- */

/** What creating an index row sends: identity plus the words the title comes from. */
export interface ConversationCreateDraft {
  readonly id: string
  readonly firstMessage: string
  readonly projectId?: string | null
  /** The settings the first turn is being sent with, when one is settled. */
  readonly modelId?: string | null
  readonly reasoningLevel?: ReasoningChoice | null
  /** The mode the first turn was admitted under, in the wire vocabulary. */
  readonly permissionMode?: ExecutionModeWire
  /** The moment the admission receipt arrived; defaults to the harness's clock. */
  readonly createdAt?: number
}

/**
 * What a rename, pin, archive, filing change, or later-turn stamp changes.
 * Absent keys are left alone; `projectId: null` clears the filing, and
 * `modelId: null` clears the model back to the default alias. `permissionMode`
 * is never null: a mode is a consent, and there is no "unset" state to clear
 * back to - the bottom of the ladder is Manual, which is a real answer.
 */
export interface ConversationPatch {
  readonly title?: string
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly projectId?: string | null
  readonly modelId?: string | null
  readonly reasoningLevel?: ReasoningChoice | null
  readonly permissionMode?: ExecutionModeWire
  readonly lastTurnAt?: number
}

/**
 * The answer to permanent destruction over one id or many. `removed` holds
 * only ids that are fully gone - journal, scoped rows, index row, and tree.
 * Anything less is not called removed: `cleanupFailures` carries one
 * sentence per id that did not fully purge, and `details` says per id what
 * was destroyed and what was not, so a partial failure is legible instead
 * of being flattened into "removed".
 */
interface PurgeDetail {
  readonly indexRow: boolean
  readonly tree: boolean
  readonly journal: boolean
  readonly scoped: boolean
  readonly errorCode?: string
  readonly error?: string
}

export interface PurgeOutcome {
  readonly removed: readonly string[]
  readonly cleanupFailures: Readonly<Record<string, string>>
  readonly details: Readonly<Record<string, PurgeDetail>>
}

function parsePurgeDetail(value: unknown): PurgeDetail | null {
  if (!isRecord(value)) return null
  const indexRow = flag(value['indexRow'])
  const tree = flag(value['tree'])
  const journal = flag(value['journal'])
  const scoped = flag(value['scoped'])
  if (indexRow === null || tree === null || journal === null || scoped === null) return null
  const errorCode = value['errorCode']
  const error = value['error']
  if (errorCode !== undefined && typeof errorCode !== 'string') return null
  if (error !== undefined && typeof error !== 'string') return null
  return {
    indexRow,
    tree,
    journal,
    scoped,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(error === undefined ? {} : { error }),
  }
}

export function parsePurgeOutcome(value: unknown): PurgeOutcome | null {
  if (!isRecord(value)) return null
  const removed = listOf(parseId, value['removed'])
  if (!isRecord(value['cleanupFailures']) || !isRecord(value['details']) || removed === null)
    return null

  const failures: Record<string, string> = {}
  for (const [key, message] of Object.entries(value['cleanupFailures'])) {
    if (typeof message !== 'string') return null
    failures[key] = message
  }
  const details: Record<string, PurgeDetail> = {}
  for (const [key, detail] of Object.entries(value['details'])) {
    const parsed = parsePurgeDetail(detail)
    if (parsed === null) return null
    details[key] = parsed
  }
  return { removed, cleanupFailures: failures, details }
}

/** Trees no index row addresses, listed for a person's sweep - never swept by the app. */
export interface OrphanTrees {
  readonly orphans: readonly string[]
}

export function parseOrphanTrees(value: unknown): OrphanTrees | null {
  if (!isRecord(value)) return null
  const orphans = listOf(parseId, value['orphans'])
  if (orphans === null) return null
  return { orphans }
}

/** What a person's orphan sweep removed, and what it could not. */
export interface OrphanSweepOutcome {
  readonly removed: readonly string[]
  readonly failures: Readonly<Record<string, string>>
}

export function parseOrphanSweepOutcome(value: unknown): OrphanSweepOutcome | null {
  if (!isRecord(value)) return null
  const removed = listOf(parseId, value['removed'])
  if (!isRecord(value['failures']) || removed === null) return null
  const failures: Record<string, string> = {}
  for (const [key, message] of Object.entries(value['failures'])) {
    if (typeof message !== 'string') return null
    failures[key] = message
  }
  return { removed, failures }
}

function parseId(value: unknown): string | null {
  return text(value)
}

export interface ProjectFolderSpec {
  readonly name: string
  readonly path: string
}

/** Everything creating a project means; the id is caller-chosen like the rest. */
export interface ProjectCreateDraft {
  readonly id?: string
  readonly name: string
  readonly icon: string
  readonly description?: string
  readonly folders?: readonly ProjectFolderSpec[]
}

export interface ProjectPatch {
  readonly name?: string
  readonly icon?: string
  readonly description?: string
}

/* -------------------------------------------------------------------------- */
/* Pending approvals                                                           */
/* -------------------------------------------------------------------------- */

/*
 * Mirrored from `GET /api/permissions/pending`: one element of what
 * `broker.list()` answers, which is a row of the durable store
 * (`STUDIO HARNESS/src/application/approval-broker.ts`). A pending row is a
 * question the permission kernel raised and nobody has answered yet - the run
 * that asked is parked until it is answered or cancelled, and the list is the
 * one source that survives a harness restart, which is why the webview polls
 * it instead of reading the conversation stream (the stream's chunk union is
 * closed; see Task 47's report, section 6).
 *
 * Only the fields the prompt renders are carried. The request's full
 * descriptor - provenance, input schema, idempotence - stays on the wire side;
 * a parser that rebuilt all of it would have to refuse rows it could have
 * shown, and a parked run is the one state this file must not make harder to
 * see.
 */

/** The verdict half of an answer; the harness accepts nothing else. */
type ApprovalVerdict = 'allow' | 'deny'

/**
 * How long an allow lasts. `always` outlives the conversation: a real grant
 * in the harness's store, which is why the prompt that offers it treats it as
 * the heavier choice.
 */
export type GrantDuration = 'once' | 'conversation' | 'always'

export interface ApprovalAnswer {
  readonly verdict: ApprovalVerdict
  readonly duration: GrantDuration
  /**
   * Which rung of the kernel's own ladder the grant is stored against.
   *
   * Omitted means the narrowest rung the kernel offered, which for a file is
   * that one file. That default is right for "just once" and wrong for the
   * two lasting answers: a grant pinned to one file makes "this conversation"
   * ask again about the next file, which is not what the words say. Only a
   * rung the kernel actually offered may be sent; anything else is narrowed
   * server-side and reported as an approver bug.
   */
  readonly scopeId?: string
}

/** One rung of the scope ladder the kernel offered; rendered, never invented here. */
interface ApprovalScopeOption {
  readonly id: string
  readonly label: string
  readonly detail: string
  /**
   * The rule this rung would store, when the kernel sent one.
   *
   * Read for one reason: the `this-folder` rung's pattern is the conversation's
   * workspace, which is what turns an absolute resource into the
   * workspace-relative path the question shows. Optional because it is the
   * kernel's own field and a row without it must still render - the sentence
   * falls back to the file's name.
   */
  readonly pattern: string | null
}

/** Why the kernel asked. `policy` asks survive every mode and are worth explaining. */
type DecisionSourceWire = 'policy' | 'grant' | 'default'

export interface PendingApprovalRecord {
  readonly id: string
  readonly createdAt: number
  readonly capabilityNamespace: string
  readonly capabilityName: string
  /** The harness's own title for the capability, e.g. "Write file". */
  readonly capabilityTitle: string
  /** What the call touches - a resolved path, or `shell:npm`. Null when the call is not narrowable. */
  readonly resource: string | null
  /** The conversation whose run raised the question, bare: `cnv_x`, not `conversation:cnv_x`. */
  readonly conversationId: string | null
  /** The scope ladder, narrowest first, exactly as the kernel offered it. */
  readonly scopes: readonly ApprovalScopeOption[]
  readonly source: DecisionSourceWire
  /** The kernel's short sentence for why this needs a person. */
  readonly reason: string
}

function parsePendingApproval(value: unknown): PendingApprovalRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const createdAt = finiteNumber(value['createdAt'])
  if (id === null || createdAt === null) return null

  // Everything the prompt renders lives under `request` and `decision`.
  const request = value['request']
  const decision = value['decision']
  if (!isRecord(request) || !isRecord(decision)) return null

  const capability = request['capability']
  const scope = request['scope']
  if (!isRecord(capability) || !isRecord(scope)) return null

  const capabilityId = capability['id']
  if (!isRecord(capabilityId)) return null
  const capabilityNamespace = text(capabilityId['namespace'])
  const capabilityName = text(capabilityId['name'])
  const capabilityTitle = text(capability['title'])
  if (capabilityNamespace === null || capabilityName === null || capabilityTitle === null) {
    return null
  }

  const resource = nullableTextOrAbsent(request['resource'])
  const conversationId = nullableTextOrAbsent(scope['conversationId'])

  const scopes = listOf(parseApprovalScope, request['scopes'])
  const source = oneOf<DecisionSourceWire>(['policy', 'grant', 'default'], decision['source'])
  const reason = text(decision['reason'])
  if (
    scopes === null ||
    source === null ||
    reason === null ||
    !resource.ok ||
    !conversationId.ok
  ) {
    return null
  }

  return {
    id,
    createdAt,
    capabilityNamespace,
    capabilityName,
    capabilityTitle,
    resource: resource.value,
    conversationId: conversationId.value,
    scopes,
    source,
    reason,
  }
}

function parseApprovalScope(value: unknown): ApprovalScopeOption | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const label = text(value['label'])
  const detail = text(value['detail'])
  if (id === null || label === null || detail === null) return null
  return { id, label, detail, pattern: text(value['pattern']) }
}

export function parsePendingApprovals(
  value: unknown,
): readonly PendingApprovalRecord[] | null {
  return listOf(parsePendingApproval, value)
}

/* -------------------------------------------------------------------------- */
/* Pending questions                                                           */
/* -------------------------------------------------------------------------- */

/*
 * Mirrored from `GET /api/questions/pending`: one element of what
 * `QuestionBroker.list()` answers, a row of the durable `pending_question`
 * table (`STUDIO HARNESS/src/questions/pending-questions.ts`). These are the
 * questions a run asks to get a DECISION, not consent for an action - which
 * is why this is a separate record from `PendingApprovalRecord` and never
 * becomes one: a permission question has no deadline and no default, a
 * product question has both, and the two vocabularies do not meet.
 *
 * The payload is what the card renders: a sentence, a short header, options
 * with the consequence of choosing each, and which option - if any - a
 * timeout may take. It carries no credential and describes no capability.
 */

/** One choice on a question, as the ask card renders it. */
interface PendingQuestionOption {
  readonly id: string
  readonly label: string
  /** What happens if this option is chosen, said before the choice. */
  readonly description: string
}

interface PendingQuestionPayload {
  readonly question: string
  /** A short label, at most twelve characters, for the compact display. */
  readonly header: string
  readonly options: readonly PendingQuestionOption[]
  /** Whether several options may be chosen at once. */
  readonly multiSelect: boolean
  /**
   * The option a timeout may take, and the only thing it may take. Null means
   * the question parks forever instead of timing out - and the card renders
   * no countdown, because a timer on a question that will wait forever is a
   * lie.
   */
  readonly recommendedOptionId: string | null
}

export interface PendingQuestionRecord {
  readonly id: string
  /** The conversation whose run asked, bare: `cnv_x`, not `conversation:cnv_x`. */
  readonly conversationId: string
  /** When the harness raised it. The queue is answered oldest first. */
  readonly createdAt: number
  /** The stored deadline, or null when this question waits indefinitely. */
  readonly expiresAt: number | null
  readonly payload: PendingQuestionPayload
}

function parsePendingQuestion(value: unknown): PendingQuestionRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const conversationId = text(value['conversationId'])
  const createdAt = finiteNumber(value['createdAt'])
  if (id === null || conversationId === null || createdAt === null) return null

  const payload = parseQuestionPayload(value['payload'])
  if (payload === null) return null

  // Null is a stored fact here - the question parks indefinitely - so null is
  // accepted and anything that is neither null nor a number refuses the row.
  const rawExpiresAt = value['expiresAt']
  let expiresAt: number | null = null
  if (rawExpiresAt !== null) {
    const parsed = finiteNumber(rawExpiresAt)
    if (parsed === null) return null
    expiresAt = parsed
  }

  return { id, conversationId, createdAt, expiresAt, payload }
}

function parseQuestionPayload(value: unknown): PendingQuestionPayload | null {
  if (!isRecord(value)) return null

  const question = text(value['question'])
  const header = text(value['header'])
  const multiSelect = value['multiSelect']
  if (question === null || header === null || typeof multiSelect !== 'boolean') return null

  const options = listOf(
    (option: unknown) => {
      if (!isRecord(option)) return null
      const id = text(option['id'])
      const label = text(option['label'])
      const description = text(option['description'])
      if (id === null || label === null || description === null) return null
      return { id, label, description }
    },
    value['options'],
  )
  if (options === null) return null

  const recommendedOptionId = text(value['recommendedOptionId'])
  return {
    question,
    header,
    options,
    multiSelect,
    ...(recommendedOptionId === null ? { recommendedOptionId: null } : { recommendedOptionId }),
  }
}

export function parsePendingQuestions(value: unknown): readonly PendingQuestionRecord[] | null {
  return listOf(parsePendingQuestion, value)
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Mirrored from `GET /api/plans/:conversationId`: one conversation's plan as
 * `PlanItemStore.list()` answers it
 * (`STUDIO HARNESS/src/plan/plan-items.ts`). The plan is the conversation's
 * standing intention - the model writes items into it, the person ticks them,
 * and this panel reads the rows rather than the transcript, so nothing is
 * lost when the message that announced the plan scrolls away.
 *
 * Statuses are the artifact vocabulary (`domain/artifacts/types`), the same
 * five that vocabulary chose over eleven synonyms. A second vocabulary for
 * the same question is how the drift starts.
 *
 * `damaged` is a state, not an error: rows that cannot be trusted make the
 * whole plan damaged, and the panel offers to clear it. An empty plan and an
 * unreadable plan are different facts, and the person is shown which one
 * they are looking at.
 */

export interface PlanItemRecord {
  readonly id: string
  readonly text: string
  readonly status: ArtifactStatus
  /** First-seen order. The panel renders in this order and nothing resorts it. */
  readonly position: number
  /** Who last touched the item - the model's write or the person's tick. */
  readonly updatedBy: 'model' | 'person'
  readonly updatedAt: number
}

export interface PlanSnapshot {
  readonly conversationId: string
  readonly items: readonly PlanItemRecord[]
  readonly damaged: boolean
}

export function parsePlanSnapshot(value: unknown): PlanSnapshot | null {
  if (!isRecord(value)) return null

  const conversationId = text(value['conversationId'])
  const damaged = value['damaged']
  if (conversationId === null || typeof damaged !== 'boolean') return null

  const items = listOf(parsePlanItem, value['items'])
  if (items === null) return null

  return { conversationId, items, damaged }
}

function parsePlanItem(value: unknown): PlanItemRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const itemText = text(value['text'])
  const status = PLAN_STATUS.get(value['status'])
  const position = finiteNumber(value['position'])
  const updatedAt = finiteNumber(value['updatedAt'])
  const updatedBy = value['updatedBy'] === 'model' || value['updatedBy'] === 'person'
    ? value['updatedBy']
    : null
  if (
    id === null ||
    itemText === null ||
    status === undefined ||
    position === null ||
    updatedAt === null ||
    updatedBy === null
  ) {
    return null
  }

  return { id, text: itemText, status, position, updatedBy, updatedAt }
}

/** The five statuses, as a set for the parser - the wire may claim any string. */
const PLAN_STATUS: ReadonlyMap<unknown, ArtifactStatus> = new Map([
  ['pending', 'pending'],
  ['running', 'running'],
  ['done', 'done'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
])

/* -------------------------------------------------------------------------- */
/* Conversation streams                                                        */
/* -------------------------------------------------------------------------- */

/*
 * The wire shapes of ADR 0045's reading half, mirrored by hand like every
 * other contract in this file. Two sources meet here:
 *
 * - Rust's `StreamEvent` (`src-tauri/src/services/stream.rs`), which is what
 *   actually arrives over a Tauri channel: a kind-tagged kebab-case union in
 *   which every variant carries the offset to resume from. The offset is
 *   opaque — `-1`, or `seq_batch` pairs — and is carried, parsed never.
 * - Flue's conversation content: the updates view's chunks and the history
 *   view's snapshot. That mirror grew past facts into content when rendering
 *   arrived, and now lives in `conversation-chunks.ts`, re-exported here so
 *   the boundary stays "import from index, not from the files". When a
 *   component needs to read what a chunk SAYS, extend that module — not this
 *   one.
 */

/** The mirror of Rust's `StreamEvent`, exactly as it serializes. */
export type WireStreamEvent =
  | {
      readonly kind: 'frame'
      readonly offset: string
      readonly event?: string | null
      readonly data: string
    }
  | { readonly kind: 'up-to-date'; readonly offset: string }
  | { readonly kind: 'keep-alive'; readonly offset: string }
  | { readonly kind: 'ended'; readonly offset: string }

export function parseWireStreamEvent(value: unknown): WireStreamEvent | null {
  if (!isRecord(value)) return null
  const offset = text(value['offset'])
  if (offset === null) return null

  switch (value['kind']) {
    case 'up-to-date':
      return { kind: 'up-to-date', offset }
    case 'keep-alive':
      return { kind: 'keep-alive', offset }
    case 'ended':
      return { kind: 'ended', offset }
    case 'frame': {
      if (typeof value['data'] !== 'string') return null
      const event = value['event']
      return {
        kind: 'frame',
        offset,
        data: value['data'],
        ...(typeof event === 'string' ? { event } : {}),
      }
    }
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* MCP servers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How a server is reached.
 *
 * Two, and there will not be a third. `sse` is the deprecated two-endpoint
 * HTTP+SSE transport; the harness does not implement it and says so by name
 * (`C-16`). `http` here means Streamable HTTP, one endpoint.
 */
export const MCP_TRANSPORTS = ['stdio', 'http'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** How a remote endpoint proves who we are. */
export const MCP_AUTH_KINDS = ['none', 'bearer', 'header'] as const
export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number]

/**
 * The lifecycle a running server is in.
 *
 * `given-up` is distinct from `failed`: failed will be retried, given-up will
 * not, and a screen that showed them the same way would leave someone waiting
 * for a retry that is never coming.
 */
const MCP_STATES = [
  'idle',
  'starting',
  'ready',
  'stopping',
  'failed',
  'given-up',
] as const
export type McpState = (typeof MCP_STATES)[number]

/**
 * Which protocol revision a server turned out to speak.
 *
 * Detected, never configured. The harness probes `server/discover` first and
 * falls back to `initialize`, so this is a fact to display rather than a
 * choice to offer - and offering it would only give someone a way to be wrong
 * about their own server.
 */
const MCP_ERAS = ['modern', 'legacy'] as const
type McpEra = (typeof MCP_ERAS)[number]

/**
 * Which scope produced the answer for a row.
 *
 * The reason a settings screen can say "on, from your defaults" rather than
 * just "on". Absent means nothing anywhere had an opinion, which resolves to
 * off.
 */
const SCOPE_KINDS = ['global', 'project', 'conversation'] as const
type ScopeKind = (typeof SCOPE_KINDS)[number]

/**
 * What one scope has decided, and what the whole chain answers.
 *
 * Three facts, because a row has to be honest about the effect, not only the
 * setting. `decision` is what is stored at this scope: on, off, or `null`
 * when it inherits - a real third answer, not a spelling of off, because
 * inherit hands the question to a wider scope while off ends it. `resolved`
 * and `decidedAt` are what the chain answers for the context the read named:
 * this scope's own answer when it decided, the wider scope's when it did not.
 * A control that showed only the decision would render "inherits" and "off"
 * as the same silence, and the model's reach differs under the two.
 */
export interface McpScopeReading {
  /** What this scope has stored: on, off, or `null` when it inherits. */
  readonly decision: boolean | null
  /** What selection resolves for the context this read was made in. */
  readonly resolved: boolean
  /** Which scope produced `resolved`. Absent when nothing anywhere decided; that resolves to off. */
  readonly decidedAt?: ScopeKind
}

interface McpServerStatus {
  readonly state: McpState
  /** Failed starts so far. Zero unless the state is failed or given-up. */
  readonly attempts: number
  readonly era?: McpEra
  readonly protocolVersion?: string
  /** Why the last attempt failed, in the words the failure used. */
  readonly lastError?: string
  /** The last of what the server wrote to stderr, when one is connected. */
  readonly diagnostics: readonly string[]
}

/**
 * A server as this app sees it.
 *
 * **No secret is here, and none can arrive.** A bearer token, or the value of
 * the variable a local server reads its key from, lives in the OS credential
 * store. The record carries the variable's NAME, which is configuration. The
 * parse below rebuilds field by field for exactly this reason: a harness that
 * one day returned a secret could not smuggle it through a spread.
 */
/** Whose server this is, and therefore whether its tools load eagerly. */
type McpProvenance = 'system' | 'user'

const MCP_PROVENANCES = ['system', 'user'] as const

export interface McpServerRecord {
  readonly id: string
  readonly title: string
  /**
   * One sentence saying what the server is for, and not the title.
   *
   * The title is the label on the row - usually a product name. This is the
   * sentence the harness puts in the model's capability inventory, so it is
   * what decides whether a run reaches for this server at all. Empty when
   * nobody has written one.
   */
  readonly description: string
  /**
   * Whether the server ships with Studio or somebody attached it.
   *
   * Read-only here. The dialog does not offer it, because it is a shipping
   * decision rather than a preference, and a switch that makes a third-party
   * server load on every turn is not one to put in front of someone without
   * the paragraph that explains what it costs.
   */
  readonly provenance: McpProvenance
  readonly transport: McpTransport
  /** Absolute path to a real executable. `stdio` only. */
  readonly command?: string
  /** A real vector, never a string: nothing downstream may re-split it. */
  readonly args: readonly string[]
  /** Non-secret environment for the child. */
  readonly env: Readonly<Record<string, string>>
  /** `http` only. */
  readonly url?: string
  readonly auth: McpAuthKind
  /** Header name when `auth` is `header`. Not a secret. */
  readonly authHeader?: string
  /** The variable a local server reads its secret from. Not the secret. */
  readonly authEnvVar?: string
  /** Whether a contained local server is given a network. `stdio` only. */
  readonly needsNetwork: boolean
  /**
   * The user's default for this server, read at the global scope.
   *
   * Not "is it running", and not one project's answer. A server can be on by
   * default and not yet started, or running because a project overrode the
   * default - so this is stored state, never inferred from `status`.
   */
  readonly enabledByDefault: boolean
  /**
   * What the narrower scopes decided, when the read asked about one.
   *
   * `project` is present when the read named a project, `conversation` when it
   * named a conversation, and neither is present from the global read, whose
   * rows are about the default itself. Absent also means a harness older than
   * the readings: such a read still works, it just cannot say what inherit
   * resolves to, which is the one thing these fields are for.
   */
  readonly project?: McpScopeReading
  readonly conversation?: McpScopeReading
  readonly status?: McpServerStatus
}

function stringMap(value: unknown): Readonly<Record<string, string>> | null {
  if (value === undefined) return {}
  if (!isRecord(value)) return null
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null
    out[key] = entry
  }
  return out
}

function parseMcpStatus(value: unknown): McpServerStatus | null {
  if (!isRecord(value)) return null
  const state = oneOf(MCP_STATES, value['state'])
  if (state === null) return null
  const attempts = typeof value['attempts'] === 'number' ? value['attempts'] : 0
  const era = oneOf(MCP_ERAS, value['era'])
  const protocolVersion = optionalText(value['protocolVersion'])
  const lastError = optionalText(value['lastError'])
  const diagnostics = Array.isArray(value['diagnostics'])
    ? value['diagnostics'].filter((entry): entry is string => typeof entry === 'string')
    : []

  if (!protocolVersion.ok || !lastError.ok) return null

  return {
    state,
    attempts,
    diagnostics,
    ...(era === null ? {} : { era }),
    ...(protocolVersion.value === undefined ? {} : { protocolVersion: protocolVersion.value }),
    ...(lastError.value === undefined ? {} : { lastError: lastError.value }),
  }
}

/**
 * One scope's reading, as the harness wrote it.
 *
 * `decision` must say which of the three answers it is rather than collapsing
 * to a boolean, because the difference between "inherits" (`null`) and "off"
 * (`false`) is the difference between the wider scope deciding and this scope
 * having ended the question - exactly the flattening this parser exists to
 * keep honest. A reading that is present but malformed is refused outright
 * rather than guessed at: the row would otherwise display an inherited state
 * it only half knows.
 */
function parseMcpScopeReading(value: unknown): McpScopeReading | null {
  if (!isRecord(value)) return null
  const decision = value['decision']
  if (typeof decision !== 'boolean' && decision !== null) return null
  const resolved = flag(value['resolved'])
  if (resolved === null) return null
  const decidedAt = oneOf(SCOPE_KINDS, value['decidedAt'])
  if (value['decidedAt'] !== undefined && decidedAt === null) return null

  return {
    decision,
    resolved,
    ...(decidedAt === null ? {} : { decidedAt }),
  }
}

export function parseMcpServer(value: unknown): McpServerRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const title = text(value['title'])
  // Absent reads as empty rather than as a parse failure: a harness that
  // predates the column is a harness this app still has to talk to, and a
  // missing sentence is exactly "nobody has written one".
  //
  // The empty string is that same answer, and must be read the same way. The
  // harness stores an undescribed server as `""` and sends `""` back, so
  // treating empty as malformed refused every server nobody had written a
  // sentence for - and because one bad row fails the whole list, a single
  // undescribed server made the entire MCP screen unreadable and every save
  // of one look like a failure while it had in fact been written.
  const described = value['description'] === '' ? undefined : value['description']
  const description = optionalText(described)
  // Absent reads as `user`, matching the harness's own default and the column
  // default behind it. Anything unrecognised also reads as `user`, which is
  // the side that withholds - a value nobody understood must not be the thing
  // that shows a server as shipping with Studio.
  const provenance = oneOf(MCP_PROVENANCES, value['provenance']) ?? 'user'
  const transport = oneOf(MCP_TRANSPORTS, value['transport'])
  const auth = oneOf(MCP_AUTH_KINDS, value['auth'])
  const command = optionalText(value['command'])
  const url = optionalText(value['url'])
  const authHeader = optionalText(value['authHeader'])
  const authEnvVar = optionalText(value['authEnvVar'])
  const env = stringMap(value['env'])
  const args = Array.isArray(value['args'])
    ? value['args'].every((entry) => typeof entry === 'string')
      ? (value['args'] as readonly string[])
      : null
    : []

  if (
    id === null ||
    title === null ||
    transport === null ||
    auth === null ||
    args === null ||
    env === null ||
    !description.ok ||
    !command.ok ||
    !url.ok ||
    !authHeader.ok ||
    !authEnvVar.ok
  ) {
    return null
  }

  // `needsNetwork` defaults to true when absent, matching the harness: every
  // already-installed server was granted a network before the field existed,
  // and reading a missing field as `false` here would draw a boundary in the
  // UI that the harness is not applying.
  const needsNetwork = value['needsNetwork'] === undefined ? true : flag(value['needsNetwork'])
  if (needsNetwork === null) return null

  // Off when absent, matching the store: no decision anywhere resolves to off,
  // and a missing field is exactly "nobody has decided".
  const enabledByDefault =
    value['enabledByDefault'] === undefined ? false : flag(value['enabledByDefault'])
  if (enabledByDefault === null) return null

  // Read when present, refused when malformed, absent when the harness
  // predates them - which is the one case where a row legitimately cannot say
  // what inherit resolves to, because nobody told it.
  const project = value['project'] === undefined ? undefined : parseMcpScopeReading(value['project'])
  const conversation =
    value['conversation'] === undefined ? undefined : parseMcpScopeReading(value['conversation'])
  if (project === null || conversation === null) return null

  const status = value['status'] === undefined ? undefined : parseMcpStatus(value['status'])

  // Rebuilt field by field, never spread from the response.
  return {
    id,
    title,
    description: description.value ?? '',
    provenance,
    transport,
    auth,
    args,
    env,
    needsNetwork,
    enabledByDefault,
    ...(project === undefined ? {} : { project }),
    ...(conversation === undefined ? {} : { conversation }),
    ...(command.value === undefined ? {} : { command: command.value }),
    ...(url.value === undefined ? {} : { url: url.value }),
    ...(authHeader.value === undefined ? {} : { authHeader: authHeader.value }),
    ...(authEnvVar.value === undefined ? {} : { authEnvVar: authEnvVar.value }),
    ...(status === undefined || status === null ? {} : { status }),
  }
}

export function parseMcpServers(value: unknown): readonly McpServerRecord[] | null {
  return listOf(parseMcpServer, value)
}

/**
 * What is sent to install or replace a server.
 *
 * The record without the parts the harness owns: `status` is observed, not
 * configured. It deliberately carries no secret field - the credential is a
 * separate call, so a draft can be logged, echoed back in an error, or held
 * in a form's state without ever being a thing that leaks a key.
 */
export type McpServerDraft = Omit<
  McpServerRecord,
  'status' | 'args' | 'env' | 'needsNetwork' | 'enabledByDefault' | 'description' | 'provenance'
> & {
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly needsNetwork?: boolean
  readonly description?: string
  /**
   * Left out of what this app sends, deliberately.
   *
   * Omitting it means the harness's default applies, and the harness's default
   * is `user`. A server somebody attached here is a user server; there is no
   * screen that should be able to say otherwise.
   */
  readonly provenance?: McpProvenance
}

export {
  readChunkFacts,
  readConversationSnapshot,
  type ChunkFacts,
  type ConversationSnapshotFacts,
} from './conversation-chunks'

/* -------------------------------------------------------------------------- */
/* Sandbox scope                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Mirrored from `GET /api/sandbox/scope`: the doors the person opened in the
 * wall. Scope is which paths a project may reach beyond its own folder;
 * level is whether the project is contained at all. The two are kept apart
 * here the same way they are kept apart in the pane.
 */

const SANDBOX_LEVELS = ['contained', 'trusted'] as const
export type SandboxLevel = (typeof SANDBOX_LEVELS)[number]

const SANDBOX_SCOPE_MODES = ['read', 'write'] as const
export type SandboxScopeMode = (typeof SANDBOX_SCOPE_MODES)[number]

const SANDBOX_SCOPE_SOURCES = ['preset', 'custom', 'question'] as const
export type SandboxScopeSource = (typeof SANDBOX_SCOPE_SOURCES)[number]

export interface SandboxScopeRow {
  readonly projectId: string
  readonly path: string
  readonly mode: SandboxScopeMode
  readonly source: SandboxScopeSource
  readonly presetId: string | null
  readonly grantedAt: number
}

/*
 * Folder trust: whether the person vouches for a directory at all.
 *
 * A different question from the two above, and a precondition rather than a
 * wall - an undecided folder refuses every write and every command whatever
 * the permission mode says. The vocabulary collides with `SandboxLevel`, whose
 * `trusted` means uncontained: these two never derive from each other, and a
 * folder can be vouched for while its project stays contained, which is the
 * ordinary case.
 */

const TRUST_DECISIONS = ['trusted', 'untrusted', 'undecided'] as const
type TrustDecision = (typeof TRUST_DECISIONS)[number]

export interface FolderTrust {
  readonly root: string
  readonly name: string
  readonly decision: TrustDecision
}

export interface SandboxScopeInfo {
  readonly project: readonly SandboxScopeRow[]
  readonly machineWide: readonly SandboxScopeRow[]
  readonly level: SandboxLevel
  /** One row per folder of the project asked about; empty when none was. */
  readonly trust: readonly FolderTrust[]
}

interface DetectedPresetPath {
  readonly path: string
  readonly mode: SandboxScopeMode
}

export interface DetectedPreset {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly paths: readonly DetectedPresetPath[]
}

function nullablePresetId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

export function parseSandboxScopeRow(value: unknown): SandboxScopeRow | null {
  if (!isRecord(value)) return null
  const projectId = typeof value['projectId'] === 'string' ? value['projectId'] : null
  const path = text(value['path'])
  const mode = oneOf(SANDBOX_SCOPE_MODES, value['mode'])
  const source = oneOf(SANDBOX_SCOPE_SOURCES, value['source'])
  const presetId = nullablePresetId(value['presetId'])
  const grantedAt = finiteNumber(value['grantedAt'])
  if (projectId === null || path === null || mode === null || source === null || !presetId.ok || grantedAt === null) {
    return null
  }
  return { projectId, path, mode, source, presetId: presetId.value, grantedAt }
}

export function parseFolderTrust(value: unknown): FolderTrust | null {
  if (!isRecord(value)) return null
  const root = text(value['root'])
  const name = typeof value['name'] === 'string' ? value['name'] : null
  const decision = oneOf(TRUST_DECISIONS, value['decision'])
  if (root === null || name === null || decision === null) return null
  return { root, name, decision }
}

export function parseSandboxScopeInfo(value: unknown): SandboxScopeInfo | null {
  if (!isRecord(value)) return null
  const project = listOf(parseSandboxScopeRow, value['project'])
  const machineWide = listOf(parseSandboxScopeRow, value['machineWide'])
  const level = oneOf(SANDBOX_LEVELS, value['level'])
  const trust = listOf(parseFolderTrust, value['trust'])
  if (project === null || machineWide === null || level === null || trust === null) return null
  return { project, machineWide, level, trust }
}

function parseDetectedPreset(value: unknown): DetectedPreset | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const title = text(value['title'])
  const description = typeof value['description'] === 'string' ? value['description'] : null
  const paths = listOf((entry: unknown) => {
    if (!isRecord(entry)) return null
    const path = text(entry['path'])
    const mode = oneOf(SANDBOX_SCOPE_MODES, entry['mode'])
    if (path === null || mode === null) return null
    return { path, mode }
  }, value['paths'])
  if (id === null || title === null || description === null || paths === null) return null
  return { id, title, description, paths }
}

export function parseDetectedPresets(value: unknown): readonly DetectedPreset[] | null {
  return listOf(parseDetectedPreset, value)
}

/*
 * The harness-side folder browser (ADR 0050, step 6).
 *
 * A folder is chosen on the machine it lives on, and a paired tab has no
 * native dialog to reach for - the file system being chosen is the PC's, not
 * the phone's. So the harness lists directories and the picker walks the
 * answer. The listing is wider than a choice on purpose: it reaches volume
 * roots and system directories, which are positions a person walks through,
 * while the wall stays at the folder write, whose refusal arrives as a
 * harness-error carrying `validateFolderPath`'s sentence.
 */

interface BrowsedDirectory {
  readonly name: string
  readonly path: string
}

export interface FolderListing {
  /** The directory listed, normalized absolute. */
  readonly path: string
  /** The way back out, or null where there is no wider directory. */
  readonly parent: string | null
  /** The child directories, names first; files are not positions. */
  readonly directories: readonly BrowsedDirectory[]
}

function parseBrowsedDirectory(value: unknown): BrowsedDirectory | null {
  if (!isRecord(value)) return null
  const name = text(value['name'])
  const path = text(value['path'])
  if (name === null || path === null) return null
  return { name, path }
}

export function parseFolderListing(value: unknown): FolderListing | null {
  if (!isRecord(value)) return null
  const path = text(value['path'])
  const parent = value['parent'] === null ? '' : text(value['parent'])
  const directories = listOf(parseBrowsedDirectory, value['directories'])
  if (path === null || parent === null || directories === null) return null
  return { path, parent: parent === '' ? null : parent, directories }
}

/* -------------------------------------------------------------------------- */
/* The measured context                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the provider said one conversation's last request actually was.
 *
 * The four parts are what a prompt is billed in, and all four of the first
 * three occupy the window: `cacheRead` is prompt the provider served from its
 * own cache and `cacheWrite` is prompt it stored while reading, so a reader
 * that counts only `input` sees a fraction of the real prompt.
 */
export interface MeasuredContextUsage {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly observedAt: number
}

/**
 * Reads the measurement, or answers null.
 *
 * Null covers both "no turn has reported yet" and a body that does not carry
 * the shape - and the caller does the same thing for both, which is fall back
 * to its estimate. A partial body is refused rather than read as zeroes: a
 * measurement missing its cache parts would read as a window a fraction as
 * full as it is, which is exactly the failure this whole path exists to fix.
 */
export function parseMeasuredContextUsage(value: unknown): MeasuredContextUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const usage = record['usage']
  if (typeof usage !== 'object' || usage === null) return null
  const parts = usage as Record<string, unknown>
  const number = (key: string): number | null => {
    const found = parts[key]
    return typeof found === 'number' && Number.isFinite(found) && found >= 0 ? found : null
  }
  const input = number('input')
  const cacheRead = number('cacheRead')
  const cacheWrite = number('cacheWrite')
  const output = number('output')
  const observedAt = number('observedAt')
  if (
    input === null ||
    cacheRead === null ||
    cacheWrite === null ||
    output === null ||
    observedAt === null
  ) {
    return null
  }
  return { input, cacheRead, cacheWrite, output, observedAt }
}

/**
 * One command the model started in the background.
 *
 * The wire shape of the harness's job status, narrowed to what the panel
 * renders. `output` is the bounded tail the harness keeps - a few hundred
 * lines - and `dropped` is how many scrolled off the front of it, which is the
 * one thing a tail cannot say about itself.
 */
export interface BackgroundJob {
  readonly id: string
  /** The command line as the person would read it. */
  readonly command: string
  readonly state: 'running' | 'exited' | 'stopped' | 'failed'
  /** Null while it runs. */
  readonly exitCode: number | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly output: string
  readonly dropped: number
  /** Why it never started, when that is what happened. */
  readonly error?: string
}

const JOB_STATES = ['running', 'exited', 'stopped', 'failed'] as const

/**
 * A generation job - an image or a video the model asked for - as the
 * harness's `MediaJobs` reports it. Its outputs are files the harness holds,
 * served at `/api/media/artifacts/<conversation>/<fileName>`.
 */
export interface MediaJob {
  readonly id: string
  readonly slot: CapabilitySlot
  /** The prompt. */
  readonly description: string
  readonly modelId: string
  readonly state: 'queued' | 'running' | 'done' | 'failed' | 'stopped'
  readonly detail: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outputs: readonly { readonly fileName: string; readonly mimeType: string }[]
  readonly error?: string
}

const MEDIA_JOB_STATES = ['queued', 'running', 'done', 'failed', 'stopped'] as const

export function parseMediaJobs(value: unknown): readonly MediaJob[] {
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>)['jobs']
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const job = parseMediaJob(row)
    return job === null ? [] : [job]
  })
}

function parseMediaJob(value: unknown): MediaJob | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = row['id']
  const slot = oneOf(CAPABILITY_SLOTS, row['slot'])
  const state = row['state']
  if (typeof id !== 'string' || id === '' || slot === null) return null
  if (typeof state !== 'string' || !MEDIA_JOB_STATES.includes(state as MediaJob['state'])) return null
  const number = (key: string): number | null => {
    const found = row[key]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
  }
  const outputs = Array.isArray(row['outputs'])
    ? row['outputs'].flatMap((output: unknown) => {
        if (typeof output !== 'object' || output === null) return []
        const record = output as Record<string, unknown>
        const fileName = record['fileName']
        const mimeType = record['mimeType']
        return typeof fileName === 'string' && typeof mimeType === 'string' ? [{ fileName, mimeType }] : []
      })
    : []
  const error = row['error']
  return {
    id,
    slot,
    description: typeof row['description'] === 'string' ? row['description'] : '',
    modelId: typeof row['modelId'] === 'string' ? row['modelId'] : '',
    state: state as MediaJob['state'],
    detail: typeof row['detail'] === 'string' ? row['detail'] : null,
    startedAt: number('startedAt') ?? 0,
    endedAt: number('endedAt'),
    outputs,
    ...(typeof error === 'string' ? { error } : {}),
  }
}

/**
 * Reads the jobs out of a listing, dropping anything malformed.
 *
 * A row that does not parse is left out rather than rendered as a job with
 * blank fields: the panel is a list of processes a person may stop, and a row
 * with no id is a stop button that cannot work.
 */
export function parseBackgroundJobs(value: unknown): readonly BackgroundJob[] {
  if (typeof value !== 'object' || value === null) return []
  const rows = (value as Record<string, unknown>)['jobs']
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const job = parseBackgroundJob(row)
    return job === null ? [] : [job]
  })
}

export function parseBackgroundJob(value: unknown): BackgroundJob | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = row['id']
  const command = row['command']
  const state = row['state']
  if (typeof id !== 'string' || id === '') return null
  if (typeof command !== 'string') return null
  if (typeof state !== 'string' || !JOB_STATES.includes(state as BackgroundJob['state'])) {
    return null
  }
  const number = (key: string): number | null => {
    const found = row[key]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
  }
  const error = row['error']
  return {
    id,
    command,
    state: state as BackgroundJob['state'],
    exitCode: number('exitCode'),
    startedAt: number('startedAt') ?? 0,
    endedAt: number('endedAt'),
    output: typeof row['output'] === 'string' ? row['output'] : '',
    dropped: number('dropped') ?? 0,
    ...(typeof error === 'string' ? { error } : {}),
  }
}
