import type { ReasoningLevel } from "../../contracts/models.js";
import {
  languageCatalogModels,
  languageCatalogProviders,
  reasoningLevelsFromPiModel,
  type PiLanguageModel,
} from "../language/pi-catalog.js";

/**
 * What the catalog knows about a model named only by its slug.
 *
 * A model added by hand to a custom provider - `glm-5.3-flash` on a gateway
 * Studio has never heard of - is very often a model the catalog serves under
 * other providers, and the facts that matter for a turn are the model's, not
 * the host's: how big its window is, how much it may write, whether it
 * reasons, whether it reads images. This answers those from the catalog so
 * the Add Model form can pre-fill them, and the person confirms or corrects
 * rather than typing from memory. The window in particular is the fact that
 * compaction stands on: a model with none is only compacted when its provider
 * refuses a request.
 *
 * ---- Matching --------------------------------------------------------------
 *
 * Hosts wrap the same slug differently - `openai/gpt-oss-120b`,
 * `accounts/fireworks/models/gpt-oss-120b`, `@cf/openai/gpt-oss-120b`,
 * `gpt-oss-120b:batch` - so a catalog id matches when its last path segment,
 * less any `:variant` suffix, equals the slug the person typed, compared
 * without case. The slug is reduced the same way, so a person who pastes a
 * host-prefixed id still lands on the model.
 *
 * ---- When hosts disagree ---------------------------------------------------
 *
 * They do, on the numbers: gpt-oss-120b is 128,000 on Bedrock and 131,072 on
 * Groq, and GLM 5.3 Flash is 1,000,000 at Z.ai and 1,310,720 on Cloudflare.
 * The rule is the value most hosts state, and on a tie the smaller one - a
 * window understated by a few thousand tokens compacts a little early, and
 * one overstated overflows, which is the worse mistake. The count of entries
 * consulted is returned so the form can say what the number rests on.
 */
export interface ModelFacts {
  /** How many catalog entries carried this slug. */
  readonly entries: number;
  readonly contextWindow: number | undefined;
  readonly maxOutputTokens: number | undefined;
  readonly reasoning: boolean;
  /** The levels of the entry that reasons at the most levels. */
  readonly reasoningLevels: readonly ReasoningLevel[];
  readonly vision: boolean;
}

/** The comparable core of a catalog or typed id: last segment, no variant. */
export function modelSlugOf(id: string): string {
  const segment = id.slice(id.lastIndexOf("/") + 1);
  const variant = segment.indexOf(":");
  return (variant === -1 ? segment : segment.slice(0, variant)).trim().toLowerCase();
}

/** The value most entries state; the smaller one when two are equally common. */
function agreedValue(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Every catalog model whose slug is the one asked for. */
function entriesFor(slug: string): readonly PiLanguageModel[] {
  const wanted = modelSlugOf(slug);
  if (wanted === "") return [];
  const found: PiLanguageModel[] = [];
  for (const provider of languageCatalogProviders()) {
    for (const model of languageCatalogModels(provider)) {
      if (modelSlugOf(model.id) === wanted) found.push(model);
    }
  }
  return found;
}

/** The catalog's word on a slug, or undefined when no entry carries it. */
export function lookupModelFacts(slug: string): ModelFacts | undefined {
  const entries = entriesFor(slug);
  if (entries.length === 0) return undefined;

  let reasoningLevels: readonly ReasoningLevel[] = [];
  for (const entry of entries) {
    const levels = reasoningLevelsFromPiModel(entry);
    if (levels.length > reasoningLevels.length) reasoningLevels = levels;
  }

  const windows = entries.map((entry) => positive(entry.contextWindow)).filter(isNumber);
  const outputs = entries.map((entry) => positive(entry.maxTokens)).filter(isNumber);
  const reads = entries.filter((entry) => entry.input.includes("image")).length;

  return {
    entries: entries.length,
    contextWindow: agreedValue(windows),
    maxOutputTokens: agreedValue(outputs),
    reasoning: entries.some((entry) => entry.reasoning),
    reasoningLevels,
    // Vision by the same majority rule as the numbers: the hosts that say the
    // model reads images against the ones that do not.
    vision: reads * 2 > entries.length,
  };
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}
