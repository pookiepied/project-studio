import { getBuiltinModels, getBuiltinProviders, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import * as v from "valibot";

import { REASONING_LEVELS, type ReasoningLevel } from "../../contracts/models.js";
import { languageProtocolSchema, type LanguageProtocol, type ModelPricing } from "../../contracts/providers.js";

/**
 * The language gateway's catalog: Pi's own generated language models.
 *
 * This is the one place outside the runtime that reads Pi's package, and
 * the library in `gateway/catalog` asks here rather than importing Pi
 * itself. Everything Pi knows about a model that the rest of the harness
 * needs - protocol, address, reasoning levels, price - is answered as a
 * contract type, so a Pi type never leaves the language gateway.
 *
 * Pi ships one model record per model per provider, regenerated with every
 * package release, so nothing here is cached or copied - the counts this
 * module reports move with the installed package and no earlier. 35 providers
 * and 1072 language models at the version this task was built against; the
 * functions below read the live package rather than restating those numbers.
 */

export type PiLanguageModel = Model<Api>;

/** The providers Pi's language catalog knows, straight from the package. */
export function languageCatalogProviders(): readonly BuiltinProvider[] {
  return getBuiltinProviders();
}

export function isLanguageCatalogProvider(providerId: string): boolean {
  return getBuiltinProviders().some((provider) => provider === providerId);
}

/** Every model one provider serves, in the package's own order. */
export function languageCatalogModels(providerId: string): readonly PiLanguageModel[] {
  const known = getBuiltinProviders().find((provider) => provider === providerId);
  return known === undefined ? [] : getBuiltinModels(known);
}

/**
 * The wire protocol most of a provider's models speak.
 *
 * Pi's model records carry `api` per model, and for every provider exactly
 * one protocol dominates - the catalog exists so one account can be named
 * once, not so each model's protocol can disagree. The majority, ties broken
 * by first occurrence in catalog order, is what a connection to that provider
 * should say about itself: it drives the probe, and nothing else, because the
 * runtime resolves each model through its own record.
 */
export function majorityProtocolFor(providerId: string): LanguageProtocol | undefined {
  const models = languageCatalogModels(providerId);
  const counts = new Map<string, number>();
  for (const model of models) {
    counts.set(model.api, (counts.get(model.api) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [api, count] of counts) {
    if (count > bestCount) {
      best = api;
      bestCount = count;
    }
  }

  const parsed = v.safeParse(languageProtocolSchema, best);
  return parsed.success ? parsed.output : undefined;
}

/**
 * The base URL most of a provider's models name.
 *
 * Pi's generated catalog carries `baseUrl` per model, not per provider, and
 * for five providers the models disagree (region- or path-shaped differences:
 * amazon-bedrock's two regions, cloudflare-ai-gateway's per-upstream paths,
 * fireworks/opencode/opencode-go differing by a trailing `/v1`). The rule is
 * the majority URL, ties broken by first occurrence in catalog order -
 * deterministic, and when models disagree there is no answer that is right
 * for all of them, only one that is right for most. `azure-openai-responses`
 * has no baseUrl on any model (its URLs are per-deployment), so it resolves
 * to undefined and such a connection keeps the honest no-address message
 * until the user supplies one.
 */
export function majorityBaseUrlFor(providerId: string): string | undefined {
  const counts = new Map<string, number>();
  for (const model of languageCatalogModels(providerId)) {
    const url = model.baseUrl;
    if (typeof url !== "string" || url.length === 0) continue;
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }

  // Strictly-greater over an insertion-ordered Map: first-seen wins ties.
  let best: string | undefined;
  let bestCount = 0;
  for (const [url, count] of counts) {
    if (count > bestCount) {
      best = url;
      bestCount = count;
    }
  }
  return best;
}

/** The reasoning levels one Pi model actually supports, in Pi's order. */
export function reasoningLevelsFromPiModel(model: Model<Api>): readonly ReasoningLevel[] {
  const known = new Set<string>(REASONING_LEVELS);
  return getSupportedThinkingLevels(model).filter(
    (level): level is ReasoningLevel => level !== "off" && known.has(level),
  );
}

export function pricingFromPiModel(cost: unknown): ModelPricing {
  const bag = isRecord(cost) ? cost : {};
  const at = (value: unknown): number | "unknown" =>
    typeof value === "number" && Number.isFinite(value) ? value : "unknown";
  return {
    input: at(bag.input),
    output: at(bag.output),
    cacheRead: at(bag.cacheRead),
    cacheWrite: at(bag.cacheWrite),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
