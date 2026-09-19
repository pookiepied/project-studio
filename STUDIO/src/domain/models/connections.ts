import type { CatalogModel } from './catalog'

/**
 * The library's first axis: the connection.
 *
 * ---- Why the connection and not the family ---------------------------------
 *
 * A row's connection is the one thing about it that is always known and
 * always right: the harness lists models per connection, and the runtime
 * reference a turn is stored under (`<vendor>/<model>`) is built from it. The
 * author - the vendor whose mark the model wears - is a guess wherever a
 * catalog names its models bare, and grouping by a guess is what made GPT-OSS
 * appear as an OpenAI family and a Cerebras family at once, and a gateway a
 * person added by hand appear as a vendor. Grouping by connection puts every
 * row under the name a person actually typed a key for, and the same model
 * served two ways shows twice on purpose: choosing between them is choosing
 * a connection, and that is what the two rows are.
 *
 * ---- Order ------------------------------------------------------------------
 *
 * Connections sort by their display names and models inside a connection by
 * theirs, numerically aware, so "Claude 3" precedes "Claude 12" the way a
 * reader expects rather than the way strings compare. A library is
 * alphabetized, not ranked.
 */

/** One connection and every catalog row it serves. */
export interface CatalogConnection {
  readonly id: string
  /** The connection as the person named it. */
  readonly name: string
  /** The vendor whose mark the connection wears - the key its logo resolves under. */
  readonly vendor: string
  readonly models: readonly CatalogModel[]
}

/**
 * Numeric-aware name order, shared by the two sorts. `numeric` is what makes
 * a second model follow a first instead of following "10"; `sensitivity:
 * base` folds case so "gpt" and "GPT" sit together.
 */
const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Groups a catalog under the connections serving it.
 *
 * Built mutable, exposed readonly: the connections handed on are frozen
 * shapes, while this one construction site needs to append. An empty catalog
 * groups to no connections, which is the caller's cue for its empty state.
 */
export function connectionCatalog(models: readonly CatalogModel[]): CatalogConnection[] {
  const drafts = new Map<string, { name: string; vendor: string; rows: CatalogModel[] }>()
  for (const model of models) {
    const draft = drafts.get(model.connectionId)
    if (draft === undefined) {
      drafts.set(model.connectionId, {
        name: model.connectionName,
        vendor: model.connectionVendor,
        rows: [model],
      })
    } else draft.rows.push(model)
  }
  return [...drafts.entries()]
    .map(([id, draft]) => ({
      id,
      name: draft.name,
      vendor: draft.vendor,
      models: [...draft.rows].sort(
        (first, second) => ORDER.compare(first.name, second.name) || ORDER.compare(first.modelId, second.modelId),
      ),
    }))
    .sort((first, second) => ORDER.compare(first.name, second.name) || ORDER.compare(first.id, second.id))
}
