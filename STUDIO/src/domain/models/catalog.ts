import type {
  DefaultSelection,
  ModelCapability,
  ModelPricing,
  ProviderConnection,
  ProviderModel,
} from '@/platform/harness'
import type { ReasoningLevel } from './types'

/**
 * The model catalog as the picker sees it: the harness's own list, mapped once
 * at this boundary from the wire records.
 *
 * ---- What this file is now -------------------------------------------------
 *
 * It was ten demo models whose own docblock said "replacing this file with a
 * fetch is the whole migration". The fetch happened; what remains is the
 * mapping, not data. Nothing here invents a model, a capability, or a price:
 * every field is read off the wire records, and a model the harness does not
 * list does not exist.
 *
 * ---- Two vendor facts, kept apart -----------------------------------------
 *
 * A model reached through OpenRouter answers two different "who" questions,
 * and the user asks for both: OpenRouter on the connection in Settings, and
 * Anthropic's mark on the model itself. So each catalog row carries
 * `connectionVendor` - the vendor whose list the connection draws from, which
 * is what a Settings row shows - and `author`, the mark the model itself
 * wears. OpenRouter names the author in its own model ids (`anthropic/...`),
 * so the author is the id's first segment there; a direct vendor connection
 * is its own author; anything else wears the custom mark.
 *
 * `id` is the runtime reference - `<vendor>/<model>` - the one string the
 * conversation index stores, the submission carries, and the run resolves.
 */

/** One model the picker can offer. Mapped from the wire, never invented. */
export interface CatalogModel {
  /** The runtime reference: `<provider>/<model>`. What a turn is stored and sent as. */
  readonly id: string
  /** The connection that serves it, as the user named it. */
  readonly connectionId: string
  /** The model id exactly as the provider names it. */
  readonly modelId: string
  readonly name: string
  /** The vendor whose mark the MODEL wears - Anthropic on a model reached through OpenRouter. */
  readonly author: string
  /** The vendor whose mark the CONNECTION wears - OpenRouter on that same model's connection. */
  readonly connectionVendor: string
  readonly connectionName: string
  readonly reasoningLevels: readonly ReasoningLevel[]
  readonly contextWindow: number | 'unknown'
  /**
   * The rest of the wire record's own facts, carried for the library's detail
   * pane rather than re-derived: what the model can do, and what a million
   * tokens of it costs. Nothing here is invented; a dimension the provider
   * never described reads "unknown", which the pane shows as such.
   */
  readonly capability: ModelCapability
  readonly pricing: ModelPricing
}

/**
 * The vendor a connection's model list belongs to: the catalog's own vendor
 * when it names one, otherwise the connection itself - the normal case for a
 * self-hosted endpoint, whose models are keyed by their own id.
 */
function connectionVendorOf(connection: ProviderConnection): string {
  return connection.catalogProvider ?? connection.id
}

/**
 * Whose mark a model wears. OpenRouter's ids carry the author (`anthropic/...`);
 * a direct vendor connection is its own author; a self-hosted model id with a
 * slash in it claims the prefix, and unknown authors fall back to the custom
 * mark at the component.
 */
function authorOf(modelId: string, vendor: string): string {
  const separator = modelId.indexOf('/')
  return separator > 0 ? modelId.slice(0, separator) : vendor
}

/** Maps one wire model onto the picker's row, against its connection. */
function catalogModelOf(
  model: ProviderModel,
  connection: ProviderConnection | undefined,
): CatalogModel {
  const vendor = connection === undefined ? model.connectionId : connectionVendorOf(connection)
  return {
    id: `${vendor}/${model.modelId}`,
    connectionId: model.connectionId,
    modelId: model.modelId,
    name: model.displayName,
    author: authorOf(model.modelId, vendor),
    connectionVendor: vendor,
    connectionName: connection?.displayName ?? model.connectionId,
    reasoningLevels: model.reasoningLevels,
    contextWindow: model.capability.contextWindow,
    capability: model.capability,
    pricing: model.pricing,
  }
}

/**
 * The whole catalog: wire rows plus the connections that name them, in the
 * order the harness listed them.
 *
 * Two rows never reach the picker and the filter states why, in the harness's
 * own vocabulary: a model its provider has stopped offering (`available`
 * false, learned by probe) and a model that cannot answer chat at all -
 * the declared speech, image, and retrieval models - which have their own
 * capability slots in Settings and no turn that could name them.
 */
export function catalogFrom(
  connections: readonly ProviderConnection[],
  models: readonly ProviderModel[],
): CatalogModel[] {
  const byId = new Map(connections.map((connection) => [connection.id, connection]))
  return models
    .filter((model) => model.available && model.capability.textGeneration !== 'unsupported')
    .map((model) => catalogModelOf(model, byId.get(model.connectionId)))
}

/** Finds a catalog row by its runtime reference. */
export function findCatalogModel(
  models: readonly CatalogModel[],
  id: string | null,
): CatalogModel | undefined {
  if (id === null) return undefined
  return models.find((model) => model.id === id)
}

/**
 * The model a turn with no model of its own will actually reach.
 *
 * The harness has had this answer all along: a conversation carrying no model
 * is sent under the stable alias `project-studio/default`, and that alias
 * resolves to the `textGeneration` slot the person set in Settings. The client
 * loaded that slot at startup and then never read it, so the picker said
 * "Choose a model" about a conversation whose model was chosen, the meter
 * divided by a stand-in window instead of the real one, and the reasoning dial
 * vanished entirely - "no model named" was being read as "no levels".
 *
 * Matched on connection and model id rather than on the row's own `id`,
 * because the slot is stored as that pair and the row's id is built from the
 * connection's vendor. Undefined when no slot is set, or when the slot points
 * at a model this catalog no longer carries - both are "nothing to show", and
 * neither is worth inventing a row for.
 */
function findDefaultModel(catalog: {
  readonly models: readonly CatalogModel[]
  readonly defaults: DefaultSelection
}): CatalogModel | undefined {
  const slot = catalog.defaults.textGeneration
  if (slot === undefined) return undefined
  return catalog.models.find(
    (model) => model.connectionId === slot.connectionId && model.modelId === slot.modelId,
  )
}

/**
 * What a surface is actually sending with, and how that was decided.
 *
 * `following` is the difference between a conversation pinned to a model and
 * one riding whatever Settings currently points at. It is not a display
 * detail: change the Chat default tomorrow and every following conversation
 * moves with it, so a surface that showed only the name would be describing a
 * pin that does not exist.
 */
export function resolveTurnModel(
  catalog: {
    readonly models: readonly CatalogModel[]
    readonly defaults: DefaultSelection
  },
  modelId: string | null,
): { readonly model: CatalogModel | undefined; readonly following: boolean } {
  const named = findCatalogModel(catalog.models, modelId)
  if (named !== undefined) return { model: named, following: false }
  if (modelId !== null) {
    // A conversation pinned to a model the catalog no longer carries. It is
    // not following the default, and saying so would be a second lie on top
    // of the first: the pin is real, the row is gone.
    return { model: undefined, following: false }
  }
  return { model: findDefaultModel(catalog), following: true }
}

/** Display copy for a reasoning level. */