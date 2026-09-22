/**
 * A model as the harness catalogues it: what it can do, what it costs, where
 * it came from, and the library of vendors it could have come from.
 */

import { isRecord } from '@/lib/guards'
import { CAPABILITY_SLOTS, CAPABILITY_STATES, type CapabilitySlot, type CapabilityState, type ConnectionServes, INVOCATION_SHAPES, type InvocationShape, MODEL_ORIGINS, type ModelOrigin, REASONING_LEVELS, type ReasoningLevel, parseConnectionServes } from './picklists'
import { flag, listOf, numberOrUnknown, oneOf, optionalText, text } from './guards'

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
  /** Reading a document's pages - scanned or not - as text. */
  readonly documentReading: CapabilityState
  /** Retrieving web results for a query. */
  readonly webSearch: CapabilityState
  /** Retrieving one named page. */
  readonly webFetch: CapabilityState
  readonly contextWindow: number | 'unknown'
  readonly maxOutputTokens: number | 'unknown'
}

/**
 * The fifteen state-valued keys, listed once so the parser cannot drift from
 * the interface: a name that is not a capability key fails to compile.
 */
export const CAPABILITY_STATE_KEYS = [
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
  'documentReading',
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
    documentReading,
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
    documentReading === undefined ||
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
    documentReading,
    webSearch,
    webFetch,
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

export function parseReasoningLevels(value: unknown): readonly ReasoningLevel[] | null {
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

export function parseLibraryProvider(value: unknown): LibraryProvider | null {
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

/**
 * `GET /api/providers/model-facts?modelId=` — what the catalog knows about a
 * slug typed by hand: the numbers most hosts state for it and whether it
 * reasons and reads images. `found: false` is the ordinary answer for a
 * model nobody has listed; the form then asks the person instead.
 */
export type ModelFacts =
  | { readonly found: false }
  | {
      readonly found: true
      readonly entries: number
      readonly contextWindow: number | null
      readonly maxOutputTokens: number | null
      readonly reasoning: boolean
      readonly reasoningLevels: readonly ReasoningLevel[]
      readonly vision: boolean
    }

export function parseModelFacts(value: unknown): ModelFacts | null {
  if (!isRecord(value)) return null
  if (value['found'] === false) return { found: false }
  if (value['found'] !== true) return null
  const entries = value['entries']
  if (typeof entries !== 'number') return null
  const reasoningLevels = parseReasoningLevels(value['reasoningLevels'])
  if (reasoningLevels === null) return null
  const positive = (field: unknown): number | null =>
    typeof field === 'number' && field > 0 ? field : null
  return {
    found: true,
    entries,
    contextWindow: positive(value['contextWindow']),
    maxOutputTokens: positive(value['maxOutputTokens']),
    reasoning: value['reasoning'] === true,
    reasoningLevels,
    vision: value['vision'] === true,
  }
}
