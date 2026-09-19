import {
  parseLibraryProviders,
  parseModelFacts,
  parseProbeResult,
  parseProviderConnection,
  parseProviderConnections,
  parseProviderDefaults,
  parseProviderIcon,
  parseProviderModel,
  parseProviderModels,
  type CapabilitySlot,
  type DefaultSelection,
  type LibraryProvider,
  type ModelCapability,
  type ModelFacts,
  type ProbeResult,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
  type ProviderIcon,
  type ProviderKind,
  type ProviderModel,
  type ReasoningLevel,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/providers`: the connections, the models each one offers, and the
 * user's defaults among them. Routes are mounted by
 * `STUDIO HARNESS/src/transport/http/create-app.ts`, and every one of them
 * sits behind the admission middleware plus a PROVIDER_MANAGEMENT scope check.
 */

const PROVIDERS_PATH = '/api/providers'

interface ModelFilter {
  readonly connectionId?: string
  readonly kind?: ProviderKind
  readonly capability?: CapabilitySlot
}

export interface ManualModelInput {
  readonly modelId: string
  readonly displayName: string
  readonly capability?: {
    readonly [K in keyof ModelCapability]?: ModelCapability[K] | undefined
  }
  readonly reasoningLevels?: readonly ReasoningLevel[]
}

export interface ProviderClient {
  listConnections(): Promise<HarnessResult<readonly ProviderConnection[]>>
  /** The vendors any catalog can name, with the capability slots each serves. */
  listLibrary(): Promise<HarnessResult<readonly LibraryProvider[]>>
  /** One vendor's real icon as SVG text, or a failure naming why not. */
  providerIcon(id: string): Promise<HarnessResult<ProviderIcon>>
  createConnection(draft: ProviderConnectionDraft): Promise<HarnessResult<ProviderConnection>>
  updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
  ): Promise<HarnessResult<ProviderConnection>>
  deleteConnection(id: string): Promise<HarnessResult<void>>
  probeConnection(id: string): Promise<HarnessResult<ProbeResult>>
  listModels(filter?: ModelFilter): Promise<HarnessResult<readonly ProviderModel[]>>
  /** The user's chosen default models, per capability slot; absent slots are unset. */
  getDefaults(): Promise<HarnessResult<DefaultSelection>>
  /** Sets (or, with undefined, clears) one slot's default. */
  setDefault(
    slot: CapabilitySlot,
    ref: { readonly connectionId: string; readonly modelId: string } | undefined,
  ): Promise<HarnessResult<void>>
  /** What the catalog knows about a slug, for the Add Model form to pre-fill. */
  lookupModelFacts(modelId: string): Promise<HarnessResult<ModelFacts>>
  /** Adds a model the catalogs have never heard of, under one connection. */
  addManualModel(
    connectionId: string,
    model: ManualModelInput,
  ): Promise<HarnessResult<ProviderModel>>
  /** Renames or hides one existing model. */
  setModelOverride(
    connectionId: string,
    modelId: string,
    patch: { readonly displayName?: string; readonly hidden?: boolean },
  ): Promise<HarnessResult<ProviderModel>>
  /** Removes one model; a catalog row comes back hidden until shown again. */
  removeModel(connectionId: string, modelId: string): Promise<HarnessResult<void>>
  /** Sets exactly which models this connection offers. */
  setModelSelection(
    connectionId: string,
    modelIds: readonly string[],
  ): Promise<HarnessResult<void>>
}

/** Only the params that were actually supplied; an empty filter adds no query. */
function query(filter: ModelFilter): string {
  const params = new URLSearchParams()
  if (filter.connectionId !== undefined) params.set('connectionId', filter.connectionId)
  if (filter.kind !== undefined) params.set('kind', filter.kind)
  if (filter.capability !== undefined) params.set('capability', filter.capability)
  const search = params.toString()
  return search === '' ? '' : `?${search}`
}

function connectionPath(id: string, suffix = ''): string {
  return `${PROVIDERS_PATH}/connections/${encodeURIComponent(id)}${suffix}`
}

function modelPath(connectionId: string, modelId: string): string {
  // The model id stays raw, slashes and all: the route names it with a
  // wildcard segment (`:modelId{.+}`), and percent-encoding the slashes
  // would change the id the harness sees.
  return connectionPath(connectionId, `/models/${modelId}`)
}

export function providerClient({ json, empty }: Requester): ProviderClient {
  return {
    listConnections() {
      return json('GET', `${PROVIDERS_PATH}/connections`, undefined, parseProviderConnections)
    },

    listLibrary() {
      return json('GET', `${PROVIDERS_PATH}/library`, undefined, parseLibraryProviders)
    },

    providerIcon(id) {
      return json(
        'GET',
        `${PROVIDERS_PATH}/icons/${encodeURIComponent(id)}`,
        undefined,
        parseProviderIcon,
      )
    },

    createConnection(draft) {
      // The draft may carry `apiKey`. It goes out in this body and is gone the
      // moment the request is serialized — the 201 that comes back is a
      // ProviderConnection, which by contract has no key on it.
      return json('POST', `${PROVIDERS_PATH}/connections`, draft, parseProviderConnection)
    },

    updateConnection(id, patch) {
      return json('PATCH', connectionPath(id), patch, parseProviderConnection)
    },

    deleteConnection(id) {
      return empty('DELETE', connectionPath(id))
    },

    probeConnection(id) {
      // A refused key or a dead endpoint is a 200 with `ok: false` — the probe
      // succeeded as a probe. Only a missing connection is a 404 here.
      return json('POST', connectionPath(id, '/probe'), undefined, parseProbeResult)
    },

    listModels(filter = {}) {
      return json('GET', `${PROVIDERS_PATH}/models${query(filter)}`, undefined, parseProviderModels)
    },

    getDefaults() {
      return json('GET', `${PROVIDERS_PATH}/defaults`, undefined, parseProviderDefaults)
    },

    setDefault(slot, ref) {
      // Clearing is a body of `null`, which the route accepts; an absent body
      // is not JSON and the route refuses it, leaving the slot as it was.
      return empty('PUT', `${PROVIDERS_PATH}/defaults/${encodeURIComponent(slot)}`, ref ?? null)
    },

    lookupModelFacts(modelId) {
      return json(
        'GET',
        `${PROVIDERS_PATH}/model-facts?modelId=${encodeURIComponent(modelId)}`,
        undefined,
        parseModelFacts,
      )
    },

    addManualModel(connectionId, model) {
      return json('POST', connectionPath(connectionId, '/models'), model, parseProviderModel)
    },

    setModelOverride(connectionId, modelId, patch) {
      return json('PATCH', modelPath(connectionId, modelId), patch, parseProviderModel)
    },

    removeModel(connectionId, modelId) {
      return empty('DELETE', modelPath(connectionId, modelId))
    },

    setModelSelection(connectionId, modelIds) {
      return empty('PUT', connectionPath(connectionId, '/model-selection'), {
        modelIds: [...modelIds],
      })
    },
  }
}
