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

/* -------------------------------------------------------------------------- */
/* Primitive guards                                                            */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
] as const
export type LanguageProtocol = (typeof LANGUAGE_PROTOCOLS)[number]

/** `mediaProtocolSchema`. */
export const MEDIA_PROTOCOLS = ['openai-images', 'openrouter-images'] as const
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

/** `CAPABILITY_SLOTS`. The `capability` filter `GET /models` accepts. */
export const CAPABILITY_SLOTS = [
  'textGeneration',
  'imageGeneration',
  'videoGeneration',
  'speechGeneration',
  'transcription',
  'embeddings',
] as const
export type CapabilitySlot = (typeof CAPABILITY_SLOTS)[number]

/**
 * Every protocol, across all three kinds. Only useful in a patch, where the
 * harness itself accepts the flat union and validates it against the kind.
 */
export type ProviderProtocol = LanguageProtocol | MediaProtocol | RetrievalProtocol

/* -------------------------------------------------------------------------- */
/* Connections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Shared by all three connection variants.
 *
 * Fields are readonly here even though the harness's inferred types are not:
 * on this side a parsed connection is a value that came off the wire, and
 * nothing in the UI has any business writing to it.
 */
interface ProviderConnectionBase {
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
}

export interface LanguageConnection extends ProviderConnectionBase {
  readonly kind: 'language'
  readonly protocol: LanguageProtocol
}

export interface MediaConnection extends ProviderConnectionBase {
  readonly kind: 'media'
  readonly protocol: MediaProtocol
}

export interface RetrievalConnection extends ProviderConnectionBase {
  readonly kind: 'retrieval'
  readonly protocol: RetrievalProtocol
}

/**
 * `providerConnectionSchema` — a variant discriminated on `kind`, so the type
 * system refuses a retrieval protocol on a language connection.
 */
export type ProviderConnection = LanguageConnection | MediaConnection | RetrievalConnection

/**
 * A connection as the caller supplies it: everything but `credential`, plus an
 * optional key that exists for exactly the length of one request.
 *
 * The harness derives this with a distributive Omit so the discriminant
 * survives; here the three variants are written out for the same reason.
 * `apiKey` is the only place in this entire module where a secret appears, and
 * it appears only on the way out.
 */
export type ProviderConnectionDraft = (
  | Omit<LanguageConnection, 'credential'>
  | Omit<MediaConnection, 'credential'>
  | Omit<RetrievalConnection, 'credential'>
) & { readonly apiKey?: string }

/**
 * `ProviderConnectionPatch`. `id` and `kind` are absent on purpose: changing
 * either makes it a different connection while models, defaults and stored
 * credentials still point at the old one.
 *
 * `baseUrl: null` clears the override; `baseUrl` absent leaves it alone. The
 * distinction is load-bearing — without the explicit clear, a base URL once
 * set could only be reassigned, never returned to the protocol default.
 */
export interface ProviderConnectionPatch {
  readonly displayName?: string
  readonly baseUrl?: string | null
  readonly enabled?: boolean
  readonly protocol?: ProviderProtocol
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
  readonly videoGeneration: CapabilityState
  readonly speechGeneration: CapabilityState
  readonly transcription: CapabilityState
  readonly contextWindow: number | 'unknown'
  readonly maxOutputTokens: number | 'unknown'
}

/**
 * The eleven state-valued keys, listed once so the parser cannot drift from
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
  'videoGeneration',
  'speechGeneration',
  'transcription',
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
  readonly shape: InvocationShape
  readonly pricing: ModelPricing
  /** Hidden from pickers without being deleted. */
  readonly hidden: boolean
  readonly origin: ModelOrigin
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
/* Error body                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the harness sends with a failure: `{ error, code }` from `failure()` in
 * the provider routes and from the admission middleware, or `{ error }` alone
 * from the two 404s, which send no code.
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

  const kind = oneOf(PROVIDER_KINDS, value['kind'])
  const protocol = value['protocol']

  // The switch is what ties protocol to kind. A flat union check would accept
  // `{ kind: 'language', protocol: 'brave' }`, which is the exact mistake the
  // harness's variant schema exists to refuse.
  switch (kind) {
    case 'language': {
      const parsed = oneOf(LANGUAGE_PROTOCOLS, protocol)
      return parsed === null ? null : { ...base, kind, protocol: parsed }
    }
    case 'media': {
      const parsed = oneOf(MEDIA_PROTOCOLS, protocol)
      return parsed === null ? null : { ...base, kind, protocol: parsed }
    }
    case 'retrieval': {
      const parsed = oneOf(RETRIEVAL_PROTOCOLS, protocol)
      return parsed === null ? null : { ...base, kind, protocol: parsed }
    }
    case null:
      return null
  }
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
    videoGeneration,
    speechGeneration,
    transcription,
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
    videoGeneration === undefined ||
    speechGeneration === undefined ||
    transcription === undefined
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
    videoGeneration,
    speechGeneration,
    transcription,
    contextWindow,
    maxOutputTokens,
  }
}

export function parseModelPricing(value: unknown): ModelPricing | null {
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

export function parseProviderModel(value: unknown): ProviderModel | null {
  if (!isRecord(value)) return null

  const connectionId = text(value['connectionId'])
  const modelId = text(value['modelId'])
  const displayName = text(value['displayName'])
  const capability = parseModelCapability(value['capability'])
  const shape = oneOf(INVOCATION_SHAPES, value['shape'])
  const pricing = parseModelPricing(value['pricing'])
  const hidden = flag(value['hidden'])
  const origin = oneOf(MODEL_ORIGINS, value['origin'])

  if (
    connectionId === null ||
    modelId === null ||
    displayName === null ||
    capability === null ||
    shape === null ||
    pricing === null ||
    hidden === null ||
    origin === null
  ) {
    return null
  }

  return { connectionId, modelId, displayName, capability, shape, pricing, hidden, origin }
}

export function parseProviderModels(value: unknown): readonly ProviderModel[] | null {
  return listOf(parseProviderModel, value)
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
  const error = text(value['error'])
  if (error === null) return null
  const code = optionalText(value['code'])
  if (!code.ok) return { error }
  return code.value === undefined ? { error } : { error, code: code.value }
}

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

export {
  absent,
  present,
  readChunkFacts,
  readChunkPosition,
  readConversationMessage,
  readConversationSnapshot,
  type ChunkFacts,
  type ChunkPosition,
  type ConversationMessageFacts,
  type ConversationSnapshotFacts,
  type MessagePartFacts,
  type MessageRole,
  type ModelRefFacts,
  type Present,
  type SettlementErrorFacts,
  type SettlementFacts,
  type TurnOutcome,
  type UsageFacts,
} from './conversation-chunks'
