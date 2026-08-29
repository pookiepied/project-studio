import type {
  ModelCapability,
  ModelPricing,
  ProviderConnection,
  ProviderModel,
} from '@/platform/harness'
import { REASONING_LEVEL_NOTES, type ReasoningChoice, type ReasoningLevel } from './types'

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

/** A catalog grouped the way the picker reads it: one group per connection. */
export interface CatalogGroup {
  readonly connectionId: string
  readonly connectionName: string
  readonly connectionVendor: string
  readonly models: readonly CatalogModel[]
}

/**
 * The vendor a connection's model list belongs to: the catalog's own vendor
 * when it names one, otherwise the connection itself - the normal case for a
 * self-hosted endpoint, whose models are keyed by their own id.
 */
export function connectionVendorOf(connection: ProviderConnection): string {
  return connection.catalogProvider ?? connection.id
}

/**
 * Whose mark a model wears. OpenRouter's ids carry the author (`anthropic/...`);
 * a direct vendor connection is its own author; a self-hosted model id with a
 * slash in it claims the prefix, and unknown authors fall back to the custom
 * mark at the component.
 */
export function authorOf(modelId: string, vendor: string): string {
  const separator = modelId.indexOf('/')
  return separator > 0 ? modelId.slice(0, separator) : vendor
}

/** Maps one wire model onto the picker's row, against its connection. */
export function catalogModelOf(
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

/** Groups a catalog under its connections, in connection order. */
export function groupCatalog(models: readonly CatalogModel[]): CatalogGroup[] {
  // Built mutable, exposed readonly: the groups handed on are frozen shapes,
  // while this one construction site needs to append.
  const drafts: {
    connectionId: string
    connectionName: string
    connectionVendor: string
    models: CatalogModel[]
  }[] = []
  const index = new Map<string, number>()
  for (const model of models) {
    let at = index.get(model.connectionId)
    if (at === undefined) {
      drafts.push({
        connectionId: model.connectionId,
        connectionName: model.connectionName,
        connectionVendor: model.connectionVendor,
        models: [],
      })
      at = drafts.length - 1
      index.set(model.connectionId, at)
    }
    const draft = drafts[at]
    if (draft !== undefined) draft.models.push(model)
  }
  return drafts.map((draft) => ({ ...draft }))
}

/** Finds a catalog row by its runtime reference. */
export function findCatalogModel(
  models: readonly CatalogModel[],
  id: string | null,
): CatalogModel | undefined {
  if (id === null) return undefined
  return models.find((model) => model.id === id)
}

/** Display copy for a reasoning choice, "default" included. */
export function reasoningChoiceNote(choice: ReasoningChoice): string {
  if (choice === 'default') return "The provider's own default"
  return REASONING_LEVEL_NOTES.find((level) => level.id === choice)?.note ?? choice
}
