/**
 * Whose model a row is: the author, and the name the author goes by.
 *
 * ---- What the author is for ------------------------------------------------
 *
 * A model's author is the vendor whose mark it wears - Anthropic on a Claude
 * row, whichever connection served it. It used to be the library's first
 * axis, and that was the mistake this file has stopped making: the author is
 * only certain where a catalog writes it into the id, and a catalog that
 * names its models bare (`gpt-oss-120b` on Cerebras, `glm-5.3-flash` on a
 * gateway a person added by hand) leaves the host standing in as the author,
 * so the same model turned up in two "families" and a custom endpoint became
 * a family of its own. The library now groups by connection - the one fact
 * every row carries for certain - and the author is what it always really
 * was: the mark beside the name, and the "by" line on the model's page.
 *
 * ---- How the author is read ----------------------------------------------
 *
 * Three sources, in order of how much they can be trusted. A prefixed id
 * (`anthropic/claude-...`) names its author outright; OpenRouter also writes
 * a tilde in front of a routing variant (`~anthropic/...`), which is a fact
 * about routing and not about whose model it is, so the tilde is dropped. A
 * bare id whose name is one the table below recognises (`claude-`, `gpt-`,
 * `llama-`) is that vendor's model, whoever serves it - this is what puts
 * OpenAI's mark on GPT-OSS under a Cerebras heading. Failing both, the
 * connection's own vendor is the author, which is exactly right for a direct
 * connection and the honest fallback for anything else.
 *
 * ---- Where the author still groups ----------------------------------------
 *
 * Inside one connection's page. An aggregator's three hundred rows in one
 * alphabet is a wall; the same rows under Anthropic, then Google, then
 * OpenAI is a shape a reader can move through. The guess is safe there:
 * a wrong author puts a row under the wrong heading of one page, not under
 * a second door on the landing.
 */
import type { CatalogModel } from './catalog'

/**
 * The vendors this app names properly.
 *
 * Keys are author ids exactly as they arrive: the id's first segment for a
 * catalog that prefixes, the connection's catalog vendor otherwise. Open
 * below on purpose - a vendor nobody has mapped renders by the fallback and
 * loses nothing but its proper nouns.
 */
const FAMILY_NAMES: Readonly<Record<string, string>> = {
  ai21: 'AI21',
  'aion-labs': 'Aion Labs',
  alibaba: 'Alibaba',
  allenai: 'Ai2',
  amazon: 'Amazon',
  anthropic: 'Anthropic',
  'arcee-ai': 'Arcee AI',
  baidu: 'Baidu',
  'bytedance-seed': 'ByteDance Seed',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  eleutherai: 'EleutherAI',
  google: 'Google',
  ibm: 'IBM',
  'ibm-granite': 'IBM Granite',
  inception: 'Inception',
  inflection: 'Inflection',
  liquid: 'Liquid AI',
  meta: 'Meta',
  'meta-llama': 'Meta',
  microsoft: 'Microsoft',
  minimax: 'MiniMax',
  mistral: 'Mistral AI',
  mistralai: 'Mistral AI',
  moonshotai: 'Moonshot AI',
  nousresearch: 'Nous Research',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  stepfun: 'StepFun',
  tencent: 'Tencent',
  together: 'Together',
  'x-ai': 'xAI',
  xai: 'xAI',
  'z-ai': 'Z.ai',
  zai: 'Z.ai',
}

/**
 * The name a vendor is printed under: its own, or the id title-cased. The
 * fallback knows one word: a trailing "ai" is the initialism, so an unmapped
 * "somebody-ai" reads "Somebody AI" and not "Somebody Ai".
 */
export function familyName(author: string): string {
  const known = FAMILY_NAMES[author]
  if (known !== undefined) return known
  const words = author.split('-').filter((word) => word !== '')
  return words
    .map((word, index) =>
      word === 'ai' && index === words.length - 1 && index > 0
        ? 'AI'
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
}

/**
 * The model names that give their author away, for ids no catalog prefixed.
 * A prefix match on the lower-cased id, first match wins, so the list is
 * ordered from the longer, more specific names down: `gpt-oss` is listed
 * only because `gpt-` would already claim it, and reads as documentation.
 */
const NAMED_AUTHORS: readonly (readonly [prefix: string, author: string])[] = [
  ['claude', 'anthropic'],
  ['gpt-oss', 'openai'],
  ['gpt-', 'openai'],
  ['chatgpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['gemini', 'google'],
  ['gemma', 'google'],
  ['llama', 'meta'],
  ['qwen', 'qwen'],
  ['qwq', 'qwen'],
  ['deepseek', 'deepseek'],
  ['mistral', 'mistralai'],
  ['mixtral', 'mistralai'],
  ['magistral', 'mistralai'],
  ['codestral', 'mistralai'],
  ['devstral', 'mistralai'],
  ['ministral', 'mistralai'],
  ['pixtral', 'mistralai'],
  ['glm', 'z-ai'],
  ['kimi', 'moonshotai'],
  ['moonshot', 'moonshotai'],
  ['grok', 'x-ai'],
  ['minimax', 'minimax'],
  ['nemotron', 'nvidia'],
  ['phi-', 'microsoft'],
  ['command', 'cohere'],
  ['sonar', 'perplexity'],
]

/**
 * Whose mark a model wears, read as the docblock describes: the id's own
 * prefix (tilde dropped), else the vendor its name gives away, else the
 * connection's vendor.
 */
export function authorOf(modelId: string, vendor: string): string {
  const separator = modelId.indexOf('/')
  if (separator > 0) {
    const prefix = modelId.slice(0, separator).toLowerCase()
    return prefix.startsWith('~') ? prefix.slice(1) : prefix
  }
  const name = modelId.toLowerCase()
  for (const [prefix, author] of NAMED_AUTHORS) {
    if (name.startsWith(prefix)) return author
  }
  return vendor
}

/** One author and every row of a connection wearing its mark. */
export interface FamilyGroup {
  readonly author: string
  readonly models: readonly CatalogModel[]
}

/**
 * Numeric-aware name order: "Claude 3" precedes "Claude 12" the way a reader
 * expects rather than the way strings compare.
 */
const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Groups rows by author, families and their models both in name order. An
 * empty list groups to no families.
 */
export function familyGroups(models: readonly CatalogModel[]): FamilyGroup[] {
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
