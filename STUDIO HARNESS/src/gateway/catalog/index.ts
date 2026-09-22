import * as v from "valibot";

import {
  kindOfCapability,
  languageProtocolSchema,
  mediaProtocolSchema,
  retrievalProtocolSchema,
  servesKind,
  type CapabilitySlot,
  type ConnectionServes,
  type InvocationShape,
  kindOfSlot,
  type MediaProtocol,
  type ModelPricing,
  type ProviderConnection,
  type ProviderKind,
} from "../../contracts/providers.js";
import type { CapabilityState, ModelCapability, ReasoningLevel } from "../../contracts/models.js";
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
import { elevenlabsListing } from "./elevenlabs-media.js";
import { falListing } from "./fal-media.js";
import { curatedKinds } from "./curation.js";
import { googleListing } from "./google-media.js";
import type { MediaListing } from "./media-listing.js";
import { openaiListing } from "./openai-media.js";
import { openrouterListing } from "./openrouter-media.js";

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
  /** Whether the featured shelf recommends it. Only a declared word can say so. */
  readonly featured: boolean;
  readonly shape: InvocationShape;
  readonly pricing: ModelPricing;
}

export interface LibraryProviderEntry {
  readonly id: string;
  readonly displayName: string;
  /**
   * Every kind this vendor can serve on one key, with the wire for each. A
   * connection created from the entry serves all of them at once; that is
   * how one OpenAI key is entered once and reaches chat, images and audio.
   */
  readonly serves: ConnectionServes;
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
    documentReading: "unknown",
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

/**
 * The declared models a connection draws: the vendor's, kept to the kinds
 * the connection serves. A model is chat, media or retrieval by what it can
 * do, so an OpenAI connection that serves only language draws OpenAI's chat
 * extras and not its image models, and one that also serves media draws
 * both.
 */
function declaredModelsForSource(
  connection: ProviderConnection,
): readonly CatalogSourceModel[] {
  const provider = declaredProviderFor(connection.catalogProvider ?? "");
  if (provider === undefined) return [];
  return provider.models
    .map((model) => ({
      modelId: model.id,
      displayName: model.displayName,
      capability: capabilityFromDeclared(model),
      reasoningLevels: model.reasoningLevels ?? [],
      featured: model.featured ?? false,
      shape: model.shape,
      pricing: unknownPricing(),
    }))
    .filter((model) => servesKind(connection, kindOfCapability(model.capability)));
}

/**
 * The models one connection draws from the built-in catalogs.
 *
 * Keyed by `catalogProvider` and matched on kind, never on the connection's
 * own id: two OpenAI accounts are two connections drawing one vendor's list.
 * A connection whose `catalogProvider` is undefined - the self-hosted case -
 * draws nothing here; such a connection serves only the models entered by
 * hand. The credential, when given, travels to listings that ask for one,
 * in the outbound header alone. Async because the live listings are read
 * here, and every caller already awaits. `live: false` reads the declared
 * and language catalogs alone - what a caller wants when the vendor's own
 * list is not its question and a socket to the vendor would be a side
 * effect (a test of something else, a store being migrated).
 */
export async function catalogModelsFor(
  connection: ProviderConnection,
  credential: string | undefined = undefined,
  options: { readonly live?: boolean } = {},
): Promise<readonly CatalogSourceModel[]> {
  const catalogProvider = connection.catalogProvider;
  if (catalogProvider === undefined) return [];

  const live = options.live === false ? [] : await liveModelsFor(connection, credential);

  if (connection.serves.language !== undefined && isLanguageCatalogProvider(catalogProvider)) {
    // Pi's language models come first; declared extras and the live listing
    // follow, and a shared id is joined rather than deduplicated - see
    // `joinedCatalogModels`.
    const pi: readonly CatalogSourceModel[] = languageCatalogModels(catalogProvider).map(
      (model) => ({
        modelId: model.id,
        displayName: model.name.length > 0 ? model.name : model.id,
        capability: capabilityFromPiModel(model),
        reasoningLevels: reasoningLevelsFromPiModel(model),
        // The language shelf has no featured of its own; the featured shelf
        // is the declared catalog's word about the few, and this is not it.
        featured: false,
        shape: "stream",
        pricing: pricingFromPiModel(model.cost),
      }),
    );
    return joinedCatalogModels([pi, declaredModelsForSource(connection), live]);
  }

  return joinedCatalogModels([declaredModelsForSource(connection), live]);
}

/** The capability dimensions a source can state. The two numbers are facts, not states. */
const CAPABILITY_STATES = [
  "textGeneration",
  "streaming",
  "reasoning",
  "toolCalling",
  "vision",
  "embeddings",
  "reranking",
  "imageGeneration",
  "imageEditing",
  "videoGeneration",
  "speechGeneration",
  "transcription",
  "documentReading",
  "webSearch",
  "webFetch",
] as const satisfies readonly (keyof Omit<ModelCapability, "contextWindow" | "maxOutputTokens">)[];

function strongerState(
  primary: CapabilityState,
  extra: CapabilityState,
): CapabilityState {
  if (primary === "supported" || extra === "supported") return "supported";
  if (primary === "unsupported" && extra === "unsupported") return "unsupported";
  return "unknown";
}

/**
 * One id, one record: later sources fold into earlier ones instead of being
 * deduplicated away.
 *
 * The vendors list one model more than once because it answers more than one
 * way - `google/gemini-3-pro-image` is a chat model Pi knows and, the same
 * hour, an image model OpenRouter's images listing knows - and a set-of-ids
 * dedupe threw the second half away, which is how the Media page lost it.
 * What joins here is the truth of both: a dimension is supported when either
 * record proves it, unsupported only when both say so, and unknown when one
 * is merely undescribed. Identity - name, pricing, levels, shape, featured -
 * stays the first record's; the second record's only readers - the media
 * slots - read capability alone, and its pricing is never shown (the plan's
 * rule).
 */
function joinedCatalogModels(
  sources: readonly (readonly CatalogSourceModel[])[],
): readonly CatalogSourceModel[] {
  const joined = new Map<string, CatalogSourceModel>();
  for (const source of sources) {
    for (const model of source) {
      const primary = joined.get(model.modelId);
      if (primary === undefined) {
        joined.set(model.modelId, model);
        continue;
      }
      const capability: { -readonly [K in keyof ModelCapability]: ModelCapability[K] } = {
        ...primary.capability,
        contextWindow: primary.capability.contextWindow,
        maxOutputTokens: primary.capability.maxOutputTokens,
      };
      for (const dimension of CAPABILITY_STATES) {
        capability[dimension] = strongerState(primary.capability[dimension], model.capability[dimension]);
      }
      joined.set(model.modelId, { ...primary, capability });
    }
  }
  return [...joined.values()];
}

/**
 * The listings, keyed by the media wire they belong to. Five vendors publish
 * a catalogue and are read through it; the three that do not (Deepgram, Fish
 * Audio, MiniMax) keep their declared lists and their undefined, which is
 * the honest entry for "the vendor has no such reading" - the compiler, not
 * a comment, remembers which are left.
 */
const MEDIA_LISTINGS: Readonly<Record<MediaProtocol, MediaListing | undefined>> = {
  openrouter: openrouterListing,
  fal: falListing,
  elevenlabs: elevenlabsListing,
  google: googleListing,
  openai: openaiListing,
  deepgram: undefined,
  "fish-audio": undefined,
  minimax: undefined,
  mistral: undefined,
};

/**
 * The models a vendor lists live rather than declares: its own catalogue, for
 * a connection that serves its media wire under its own vendor. Empty for
 * every other connection, and empty offline.
 */
async function liveModelsFor(
  connection: ProviderConnection,
  credential: string | undefined,
): Promise<readonly CatalogSourceModel[]> {
  const wire = connection.serves.media;
  // The vendor's list belongs to the vendor: a connection pointed at
  // somebody else's wire (a Google connection speaking the OpenAI wire, say)
  // draws that somebody's listing from that somebody's connection, not here.
  if (wire === undefined || connection.catalogProvider !== wire) return [];
  const listing = MEDIA_LISTINGS[wire];
  if (listing === undefined) return [];
  const baseUrl = connection.baseUrl ?? declaredProviderFor(wire)?.baseUrl;
  if (baseUrl === undefined) return [];
  return listing.models(baseUrl, credential);
}

/**
 * The provider library a settings screen offers: every vendor the two
 * catalogs can name, once each, with every kind it serves on one key and
 * the capabilities it has models for.
 *
 * One entry per vendor is the point. OpenAI used to appear as a language
 * provider from Pi's catalog and, separately, as the owner of some declared
 * media models; a person adding it had to know which to pick. Now the
 * language gateway answers for the chat half, the declared catalog for the
 * rest, and the two halves are joined here under the vendor's one id.
 */
export async function listLibraryProviders(): Promise<readonly LibraryProviderEntry[]> {
  return (await everyLibraryProvider()).flatMap((entry) => curated(entry, curatedKinds()));
}

/**
 * One entry cut to the kinds the curation offers, or nothing when it offers
 * none. The wires and the capabilities narrow together, so a vendor offered
 * for images alone does not advertise chat; the model count stays the
 * vendor's whole, because it is a size and not a promise.
 */
function curated(
  entry: LibraryProviderEntry,
  offered: ReadonlyMap<string, ReadonlySet<ProviderKind>>,
): readonly LibraryProviderEntry[] {
  const kinds = offered.get(entry.id);
  if (kinds === undefined) return [];
  const serves: { -readonly [K in keyof ConnectionServes]: ConnectionServes[K] } = {};
  if (kinds.has("language") && entry.serves.language !== undefined) serves.language = entry.serves.language;
  if (kinds.has("media") && entry.serves.media !== undefined) serves.media = entry.serves.media;
  if (kinds.has("retrieval") && entry.serves.retrieval !== undefined) serves.retrieval = entry.serves.retrieval;
  if (Object.keys(serves).length === 0) return [];
  return [
    {
      ...entry,
      serves,
      capabilities: entry.capabilities.filter((slot) => kinds.has(kindOfSlot(slot))),
    },
  ];
}

/** Every vendor the two catalogs can name, before the curation says which to offer. */
async function everyLibraryProvider(): Promise<readonly LibraryProviderEntry[]> {
  const entries: LibraryProviderEntry[] = [];
  const seen = new Set<string>();

  for (const providerId of languageCatalogProviders()) {
    const serves = libraryServesFor(providerId);
    if (serves === undefined) continue;
    const models = languageCatalogModels(providerId);
    const declared = declaredProviderFor(providerId);
    seen.add(providerId);
    entries.push({
      id: providerId,
      displayName: declared?.displayName ?? displayNameFor(providerId),
      serves,
      baseUrl: majorityBaseUrlFor(providerId) ?? declared?.baseUrl,
      capabilities: [
        ...slotsServedBy([
          ...models.map((model) => capabilityFromPiModel(model)),
          ...(declared?.models.map((model) => capabilityFromDeclared(model)) ?? []),
        ]),
        ...(declared?.liveCapabilities ?? []),
      ],
      modelCount: models.length + (declared?.models.length ?? 0),
    });
  }

  for (const provider of DECLARED_PROVIDERS) {
    if (seen.has(provider.id)) continue;
    const serves = libraryServesFor(provider.id);
    if (serves === undefined) continue;
    entries.push({
      id: provider.id,
      displayName: provider.displayName,
      serves,
      baseUrl: provider.baseUrl,
      capabilities: [
        ...slotsServedBy(provider.models.map((model) => capabilityFromDeclared(model))),
        ...(provider.liveCapabilities ?? []),
      ],
      modelCount: provider.models.length,
    });
  }

  return entries;
}

/**
 * Every kind a library provider can serve on one key, with the wire for
 * each: language from the language gateway's majority protocol, the rest
 * from the declared catalog. The library is the only place that knows this,
 * which is why connection creation asks here rather than letting the caller
 * guess. Undefined for a vendor neither catalog names, or one whose declared
 * wires all fail to parse - a contract entry that was never added.
 */
/**
 * The address a catalog-backed connection calls when the person never typed
 * one. The declared catalog answers first, because it names every media and
 * retrieval vendor and carries the address each adapter was written against;
 * the language catalog answers for the vendors only it knows, with the
 * majority URL among that vendor's models. Undefined for a vendor neither
 * catalog names, or one whose address is per-deployment (Azure).
 */
export function libraryBaseUrlFor(providerId: string): string | undefined {
  return declaredProviderFor(providerId)?.baseUrl ?? majorityBaseUrlFor(providerId);
}

export function libraryServesFor(providerId: string): ConnectionServes | undefined {
  const declared = declaredProviderFor(providerId)?.serves ?? {};
  const language =
    majorityProtocolFor(providerId) ?? parseWith(languageProtocolSchema, declared.language);
  const media = parseWith(mediaProtocolSchema, declared.media);
  const retrieval = parseWith(retrievalProtocolSchema, declared.retrieval);
  if (language === undefined && media === undefined && retrieval === undefined) return undefined;
  return {
    ...(language === undefined ? {} : { language }),
    ...(media === undefined ? {} : { media }),
    ...(retrieval === undefined ? {} : { retrieval }),
  };
}

function parseWith<const TOptions extends readonly string[]>(
  schema: v.PicklistSchema<TOptions, undefined>,
  protocol: string | undefined,
): TOptions[number] | undefined {
  if (protocol === undefined) return undefined;
  const result = v.safeParse(schema, protocol);
  return result.success ? result.output : undefined;
}
