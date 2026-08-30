import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
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
import { REASONING_LEVELS, type ModelCapability, type ReasoningLevel } from "../../contracts/models.js";
import { capabilityFromPiModel } from "../../models/local/catalog.js";
import {
  isLanguageCatalogProvider,
  languageCatalogModels,
  languageCatalogProviders,
  majorityBaseUrlFor,
  majorityProtocolFor,
} from "./language-catalog.js";
import { imageCatalogModels, imageCatalogProviders, type PiImageModel } from "./image-catalog.js";
import { DECLARED_PROVIDERS, declaredProviderFor, type DeclaredModel } from "./declared-catalog.js";

/**
 * The provider library, joined from three sources into one shape.
 *
 * A provider is a source; a capability is a tag on a model. OpenAI is one
 * provider that serves chat, transcription, speech, images, and embeddings;
 * OpenRouter is one provider that serves chat and images. The three sources -
 * Pi's language catalog, Pi's image catalog, and Studio's own declared catalog
 * for everything Pi has none of - are read here and nowhere else, and what
 * leaves this module is one shape regardless of origin.
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
 * Pi's image model records omit the fields a language record carries, so the
 * capability they map to is stated directly rather than derived: generating an
 * image is the entire point, editing is earned by accepting an input image,
 * and every language-shaped dimension is unsupported rather than unknown.
 */
function capabilityFromImageModel(model: PiImageModel): ModelCapability {
  const acceptsImage = model.input.includes("image");
  return {
    textGeneration: "unsupported",
    streaming: "unsupported",
    reasoning: "unsupported",
    toolCalling: "unsupported",
    vision: acceptsImage ? "supported" : "unsupported",
    embeddings: "unsupported",
    reranking: "unsupported",
    imageGeneration: "supported",
    imageEditing: acceptsImage ? "supported" : "unsupported",
    videoGeneration: "unsupported",
    speechGeneration: "unsupported",
    transcription: "unsupported",
    webSearch: "unsupported",
    webFetch: "unsupported",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
  };
}

function pricingFromImageModel(model: PiImageModel): ModelPricing {
  return {
    input: model.cost.input,
    output: model.cost.output,
    cacheRead: model.cost.cacheRead,
    cacheWrite: model.cost.cacheWrite,
  };
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

/** The reasoning levels one Pi model actually supports, in Pi's order. */
function reasoningLevelsFromPiModel(model: Model<Api>): readonly ReasoningLevel[] {
  const known = new Set<string>(REASONING_LEVELS);
  return getSupportedThinkingLevels(model).filter(
    (level): level is ReasoningLevel => level !== "off" && known.has(level),
  );
}

function pricingFromPiModel(cost: unknown): ModelPricing {
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
 * hand. The image catalog is async because Pi ships it behind a dynamic
 * import, which makes this function async; every caller already is.
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

  if (connection.kind === "media") {
    const providers = await imageCatalogProviders();
    if (providers.includes(catalogProvider)) {
      return (await imageCatalogModels(catalogProvider)).map((model) => ({
        modelId: model.id,
        displayName: model.name.length > 0 ? model.name : model.id,
        capability: capabilityFromImageModel(model),
        reasoningLevels: [],
        shape: "sync",
        pricing: pricingFromImageModel(model),
      }));
    }
  }

  return declaredModelsForSource(connection);
}

/**
 * The provider library a settings screen offers: every vendor the three
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

  for (const providerId of await imageCatalogProviders()) {
    const models = await imageCatalogModels(providerId);
    const firstApi = models[0]?.api ?? "openrouter-images";
    const parsed = v.parse(mediaProtocolSchema, firstApi);
    const protocol: MediaProtocol = parsed;
    entries.push({
      id: providerId,
      displayName: displayNameFor(providerId),
      kind: "media",
      protocol,
      baseUrl: models[0]?.baseUrl,
      capabilities: slotsServedBy(models.map((model) => capabilityFromImageModel(model))),
      modelCount: models.length,
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
