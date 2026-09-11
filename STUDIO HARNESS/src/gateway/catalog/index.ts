import * as v from "valibot";

import {
  languageProtocolSchema,
  mediaProtocolSchema,
  retrievalProtocolSchema,
  type CapabilitySlot,
  type InvocationShape,
  type LanguageProtocol,
  type MediaProtocol,
  type ModelPricing,
  type ProviderConnection,
  type ProviderKind,
  type RetrievalProtocol,
} from "../../contracts/providers.js";
import type { ModelCapability, ReasoningLevel } from "../../contracts/models.js";
import { capabilityFromPiModel } from "../language/local/catalog.js";
import {
  isLanguageCatalogProvider,
  languageCatalogModels,
  languageCatalogProviders,
  majorityBaseUrlFor,
  majorityProtocolFor,
  pricingFromPiModel,
  reasoningLevelsFromPiModel,
} from "../language/pi-catalog.js";
import { DECLARED_PROVIDERS, declaredProviderFor, type DeclaredModel } from "./declared-catalog.js";

/**
 * The provider library, joined from two sources into one shape.
 *
 * A provider is a source; a capability is a tag on a model. OpenAI is one
 * provider that serves chat, transcription, speech, images, and embeddings.
 * The two sources - the language gateway's catalog, which is Pi's, and
 * Studio's own declared catalog for everything beyond language - are read
 * here and nowhere else, and what leaves this module is one shape regardless
 * of origin. Nothing here touches Pi: the language gateway answers for its
 * own models, and the library only asks.
 */

/** A model as a catalog source states it, before a connection stamps it. */
export interface CatalogSourceModel {
  readonly modelId: string;
  readonly displayName: string;
  readonly capability: ModelCapability;
  readonly reasoningLevels: readonly ReasoningLevel[];
  readonly shape: InvocationShape;
  readonly pricing: ModelPricing;
}

export type ConnectionProtocol = LanguageProtocol | MediaProtocol | RetrievalProtocol;

export interface LibraryProviderEntry {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly protocol: ConnectionProtocol;
  /** The provider's own endpoint, when one address serves every model. */
  readonly baseUrl: string | undefined;
  /** The slots this provider has at least one model for. */
  readonly capabilities: readonly CapabilitySlot[];
  readonly modelCount: number;
}

const SLOTS: readonly CapabilitySlot[] = [
  "textGeneration",
  "imageGeneration",
  "imageEditing",
  "videoGeneration",
  "speechGeneration",
  "transcription",
  "embeddings",
  "webSearch",
  "webFetch",
];

function slotsServedBy(models: readonly ModelCapability[]): readonly CapabilitySlot[] {
  return SLOTS.filter((slot) =>
    models.some((capability) => capability[slot] === "supported"),
  );
}

/** Vendor display names the catalogs do not carry; anything else is prettified. */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  google: "Google",
};

function displayNameFor(providerId: string): string {
  const named = PROVIDER_DISPLAY_NAMES[providerId];
  if (named !== undefined) return named;
  return providerId
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * A declared model's capability, completed over an all-unknown floor.
 *
 * Whatever the declaration states stands; everything it omits stays unknown,
 * because this catalog is Studio's own word and Studio does not get to claim
 * a dimension it never measured.
 */
function capabilityFromDeclared(model: DeclaredModel): ModelCapability {
  const floor: ModelCapability = {
    textGeneration: "unknown",
    streaming: "unknown",
    reasoning: "unknown",
    toolCalling: "unknown",
    vision: "unknown",
    embeddings: "unknown",
    reranking: "unknown",
    imageGeneration: "unknown",
    imageEditing: "unknown",
    videoGeneration: "unknown",
    speechGeneration: "unknown",
    transcription: "unknown",
    webSearch: "unknown",
    webFetch: "unknown",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
  };
  return { ...floor, ...model.capability };
}

function unknownPricing(): ModelPricing {
  return {
    input: "unknown",
    output: "unknown",
    cacheRead: "unknown",
    cacheWrite: "unknown",
  };
}

function declaredModelsForSource(
  connection: ProviderConnection,
): readonly CatalogSourceModel[] {
  const provider = declaredProviderFor(connection.catalogProvider ?? "");
  if (provider === undefined || provider.kind !== connection.kind) return [];
  return provider.models.map((model) => ({
    modelId: model.id,
    displayName: model.displayName,
    capability: capabilityFromDeclared(model),
    reasoningLevels: model.reasoningLevels ?? [],
    shape: model.shape,
    pricing: unknownPricing(),
  }));
}

/**
 * The models one connection draws from the built-in catalogs.
 *
 * Keyed by `catalogProvider` and matched on kind, never on the connection's
 * own id: two OpenAI accounts are two connections drawing one vendor's list.
 * A connection whose `catalogProvider` is undefined - the self-hosted case -
 * draws nothing here; such a connection serves only the models entered by
 * hand. Async because the live listings of step 4 of the gateway plan will
 * be read here, and every caller already awaits.
 */
export async function catalogModelsFor(
  connection: ProviderConnection,
): Promise<readonly CatalogSourceModel[]> {
  const catalogProvider = connection.catalogProvider;
  if (catalogProvider === undefined) return [];

  if (connection.kind === "language" && isLanguageCatalogProvider(catalogProvider)) {
    // Pi's language models come first; declared extras for the same vendor
    // arrive after and are deduplicated by id below.
    const pi: readonly CatalogSourceModel[] = languageCatalogModels(catalogProvider).map(
      (model) => ({
        modelId: model.id,
        displayName: model.name.length > 0 ? model.name : model.id,
        capability: capabilityFromPiModel(model),
        reasoningLevels: reasoningLevelsFromPiModel(model),
        shape: "stream",
        pricing: pricingFromPiModel(model.cost),
      }),
    );
    const declared = declaredModelsForSource(connection);
    const seen = new Set(pi.map((model) => model.modelId));
    return [...pi, ...declared.filter((model) => !seen.has(model.modelId))];
  }

  return declaredModelsForSource(connection);
}

/**
 * The provider library a settings screen offers: every vendor the two
 * catalogs can name, each with the capabilities it actually serves and the
 * protocol a connection to it should speak.
 */
export async function listLibraryProviders(): Promise<readonly LibraryProviderEntry[]> {
  const entries: LibraryProviderEntry[] = [];

  for (const providerId of languageCatalogProviders()) {
    const models = languageCatalogModels(providerId);
    const declared = DECLARED_PROVIDERS.find(
      (provider) => provider.id === providerId && provider.kind === "language",
    );
    const capabilities = slotsServedBy([
      ...models.map((model) => capabilityFromPiModel(model)),
      ...(declared?.models.map((model) => capabilityFromDeclared(model)) ?? []),
    ]);
    const protocol = majorityProtocolFor(providerId);
    if (protocol === undefined) continue;
    entries.push({
      id: providerId,
      displayName: displayNameFor(providerId),
      kind: "language",
      protocol,
      baseUrl: majorityBaseUrlFor(providerId),
      capabilities,
      modelCount: models.length + (declared?.models.length ?? 0),
    });
  }

  for (const provider of DECLARED_PROVIDERS) {
    if (provider.kind === "language" && isLanguageCatalogProvider(provider.id)) {
      // Already listed above, with Pi's models beside the declared ones.
      continue;
    }
    const protocol = parseProtocol(provider.protocol);
    if (protocol === undefined) continue;
    entries.push({
      id: provider.id,
      displayName: provider.displayName,
      kind: provider.kind,
      protocol,
      baseUrl: provider.baseUrl,
      capabilities: slotsServedBy(provider.models.map((model) => capabilityFromDeclared(model))),
      modelCount: provider.models.length,
    });
  }

  return entries;
}

/**
 * The protocol a new connection to a library provider should speak.
 *
 * The library is the only place that knows this, which is why connection
 * creation asks here rather than letting the caller guess.
 */
export function libraryProtocolFor(providerId: string): ConnectionProtocol | undefined {
  const language = majorityProtocolFor(providerId);
  if (language !== undefined) return language;
  return parseProtocol(declaredProviderFor(providerId)?.protocol);
}

function parseProtocol(protocol: string | undefined): ConnectionProtocol | undefined {
  if (protocol === undefined) return undefined;
  const language = v.safeParse(languageProtocolSchema, protocol);
  if (language.success) return language.output;
  const media = v.safeParse(mediaProtocolSchema, protocol);
  if (media.success) return media.output;
  const retrieval = v.safeParse(retrievalProtocolSchema, protocol);
  if (retrieval.success) return retrieval.output;
  return undefined;
}
