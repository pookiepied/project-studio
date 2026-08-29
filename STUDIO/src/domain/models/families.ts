import type { CatalogModel } from './catalog'

/**
 * The library's first axis: the model family.
 *
 * ---- Why the family is the author ------------------------------------------
 *
 * A catalog row already carries the one fact a family needs: `author`, the
 * vendor whose mark the model wears. OpenRouter names that author in its own
 * ids (`anthropic/...`); a direct vendor connection is its own author; and the
 * same author arrives twice when a family is reachable two ways - Anthropic
 * directly and through OpenRouter are one family served by two connections.
 * So the family is not invented here and no second taxonomy is maintained:
 * grouping by `author` IS the catalog's own categorization, read out instead
 * of flattened away.
 *
 * ---- What this file adds to that -------------------------------------------
 *
 * Two things, both display copy. `familyName` resolves a vendor id to the
 * name the vendor actually uses - the ids that arrive in practice are
 * lower-case slugs (`mistralai`, `x-ai`) and a library that prints them raw
 * reads like a log file. The table is a list of the vendors' own names and
 * nothing else; an id the table has never heard of falls back to its own
 * words, title-cased, which is honest for a vendor nobody has mapped yet.
 *
 * `familyCatalog` groups and orders. Families sort by name - a library is
 * alphabetized, not ranked - and the models inside a family sort by name with
 * numeric awareness, so "Claude 3" precedes "Claude 12" the way a reader
 * expects rather than the way strings compare.
 */

/** One vendor and every catalog row wearing its mark. */
export interface CatalogFamily {
  /** The vendor id the rows carry as `author` - also the mark's resolution key. */
  readonly author: string
  readonly models: readonly CatalogModel[]
}

/**
 * The vendors this app names properly.
 *
 * Keys are author ids exactly as they arrive (`authorOf`'s output), which for
 * OpenRouter rows is the id's first segment and for direct connections is the
 * connection's catalog vendor. Deliberately open below: a self-hosted or
 * unlisted vendor renders by the fallback and loses nothing but its proper
 * nouns.
 */
const FAMILY_NAMES: Readonly<Record<string, string>> = {
  amazon: 'Amazon',
  anthropic: 'Anthropic',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  google: 'Google',
  meta: 'Meta',
  microsoft: 'Microsoft',
  mistral: 'Mistral AI',
  mistralai: 'Mistral AI',
  moonshotai: 'Moonshot AI',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  together: 'Together',
  'x-ai': 'xAI',
  'z-ai': 'Z.ai',
}

/** The name a family is printed under: the vendor's own, or the id title-cased. */
export function familyName(author: string): string {
  const known = FAMILY_NAMES[author]
  if (known !== undefined) return known
  return author
    .split('-')
    .map((word) => (word === '' ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

/**
 * Numeric-aware name order, shared by the two sorts. `numeric` is what makes
 * a second model follow a first instead of following "10"; `sensitivity:
 * base` folds case so "gpt" and "GPT" sit together.
 */
const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Groups a catalog under the vendors whose marks its rows wear.
 *
 * Built mutable, exposed readonly: the families handed on are frozen shapes,
 * while this one construction site needs to append. An empty catalog groups
 * to no families, which is the caller's cue for its empty state.
 */
export function familyCatalog(models: readonly CatalogModel[]): CatalogFamily[] {
  const drafts = new Map<string, CatalogModel[]>()
  for (const model of models) {
    const draft = drafts.get(model.author)
    if (draft === undefined) drafts.set(model.author, [model])
    else draft.push(model)
  }
  return [...drafts.entries()]
    .map(([author, rows]) => ({
      author,
      models: [...rows].sort(
        (first, second) => ORDER.compare(first.name, second.name) || ORDER.compare(first.modelId, second.modelId),
      ),
    }))
    .sort(
      (first, second) =>
        ORDER.compare(familyName(first.author), familyName(second.author)) ||
        ORDER.compare(first.author, second.author),
    )
}

/**
 * The connections serving a family, in first-seen order, deduplicated: the
 * same author is often reachable through one direct connection and one
 * aggregator, and "Anthropic · OpenRouter" is the fact a family card states
 * once instead of once per model.
 */
export function connectionsOf(family: CatalogFamily): readonly string[] {
  return [...new Set(family.models.map((model) => model.connectionName))]
}
