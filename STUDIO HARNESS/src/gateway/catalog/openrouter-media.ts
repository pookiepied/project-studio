import type { ModelCapability } from "../../contracts/models.js";
import {
  capabilityFor,
  createMediaListing,
  dataEntries,
  UNKNOWN_MODEL_PRICING,
  type MediaListing,
  type MediaListingFetch,
} from "./media-listing.js";
import type { CatalogSourceModel } from "./index.js";

/**
 * OpenRouter's media catalogue, read live.
 *
 * OpenRouter's language models come from the language gateway's catalog
 * like every other vendor's. Its media models do not come from anywhere
 * static: the listing moves weekly - 52 image models and 29 video models on
 * the day this was written - and a hand-kept copy would be stale before it
 * was committed. So a connection that serves OpenRouter's media wire reads
 * the five listings OpenRouter publishes, without a key, and the shared
 * machinery in `media-listing.ts` caches each connection's answer for an
 * hour: long enough that a settings screen does not fetch five listings on
 * every paint, short enough that a model released this morning is there
 * this afternoon.
 *
 * Offline, or with the listings unreachable, the answer is empty and the
 * declared catalog stands; nothing here throws into a settings screen. No
 * pricing is read: the reasons live in `media-listing.ts`, which is also
 * what answers for the hour's cache, the empty-not-cached rule, and the
 * unsupported floor - this file is the vendor's half, and only that.
 */

/** Injectable for tests: the fetch of one listing URL, answering its JSON text. */
export type ListingFetch = (url: string) => Promise<string>;

interface Earned {
  readonly earned: Partial<ModelCapability>;
  readonly shape: CatalogSourceModel["shape"];
}

function model(
  entry: Record<string, unknown>,
  { earned, shape }: Earned,
): CatalogSourceModel | undefined {
  if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
  const voiceIds = earned.speechGeneration === "supported" && Array.isArray(entry.supported_voices)
    ? entry.supported_voices.filter((voice: unknown): voice is string => typeof voice === "string" && voice.trim().length > 0)
    : [];
  return {
    modelId: entry.id,
    displayName: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
    capability: capabilityFor(earned),
    reasoningLevels: [],
    // Nothing OpenRouter lists is featured: the recommendation is a declared
    // word about the few, and the live list is the vendor's, unhinted.
    featured: false,
    shape,
    pricing: UNKNOWN_MODEL_PRICING,
    ...(voiceIds.length === 0 ? {} : { voiceIds }),
  };
}

/** Whether an image model takes input images, which is what earns editing. */
function takesInputImages(entry: Record<string, unknown>): boolean {
  const parameters = entry.supported_parameters;
  if (isRecord(parameters) && isRecord(parameters.input_references)) {
    const max = parameters.input_references.max;
    return typeof max !== "number" || max > 0;
  }
  const architecture = entry.architecture;
  return (
    isRecord(architecture) &&
    Array.isArray(architecture.input_modalities) &&
    architecture.input_modalities.includes("image")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One of the five listings, read and mapped. A listing that fails or answers
 * nonsense is that kind's empty, not the catalogue's failure: a settings
 * screen shows the four the vendor did answer, and the fifth answers on the
 * next read, when the empty-not-cached rule brings the questions back.
 */
async function oneListing(
  url: string,
  fetch: MediaListingFetch,
  earn: (entry: Record<string, unknown>) => Earned | undefined,
): Promise<readonly CatalogSourceModel[]> {
  try {
    return dataEntries(await fetch(url, {})).flatMap((entry) => {
      const earned = earn(entry);
      if (earned === undefined) return [];
      const mapped = model(entry, earned);
      return mapped === undefined ? [] : [mapped];
    });
  } catch {
    return [];
  }
}

const NO_KEY = undefined;

export const openrouterListing: MediaListing = createMediaListing({
  vendor: "OpenRouter",
  read: async ({ origin, fetch: listingFetch }) => {
    // Each listing answers exactly its own kind, so nothing the vendor lists
    // goes unclassified and the dropped count stays zero: the query did the
    // filtering.
    const [speech, transcription, documents, images, videos] = await Promise.all([
      oneListing(`${origin}/models?output_modalities=speech`, listingFetch, () => ({
        earned: { speechGeneration: "supported" },
        shape: "sync",
      })),
      oneListing(`${origin}/models?output_modalities=transcription`, listingFetch, () => ({
        earned: { transcription: "supported" },
        shape: "sync",
      })),
      // The chat models that take a file as input: the ones a PDF reaches
      // whole, pages and pictures, rather than through the parser. They are
      // language models Pi already lists, so this half joins theirs by id.
      oneListing(`${origin}/models?input_modalities=file`, listingFetch, () => ({
        earned: { documentReading: "supported" },
        shape: "sync",
      })),
      oneListing(`${origin}/images/models`, listingFetch, (entry) => ({
        earned: {
          imageGeneration: "supported",
          ...(takesInputImages(entry)
            ? { imageEditing: "supported" as const, vision: "supported" as const }
            : {}),
        },
        shape: "sync",
      })),
      oneListing(`${origin}/videos/models`, listingFetch, () => ({
        earned: { videoGeneration: "supported" },
        shape: "poll",
      })),
    ]);

    return {
      models: [...speech, ...transcription, ...documents, ...images, ...videos],
      dropped: 0,
    };
  },
});

export async function openrouterMediaModels(
  baseUrl: string,
  options: { readonly fetch?: ListingFetch; readonly now?: () => number } = {},
): Promise<readonly CatalogSourceModel[]> {
  return openrouterListing.models(baseUrl, NO_KEY, options);
}

/** For tests. */
export function forgetOpenrouterListings(): void {
  openrouterListing.forget();
}
