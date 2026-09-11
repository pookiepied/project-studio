import { MediaError } from "../../contracts/media.js";
import type { ModelCapability } from "../../contracts/models.js";
import { requestDirect } from "../../net/http.js";
import type { CatalogSourceModel } from "./index.js";

/**
 * OpenRouter's media catalogue, read live.
 *
 * OpenRouter's language models come from the language gateway's catalog
 * like every other vendor's. Its media models do not come from anywhere
 * static: the listing moves weekly - 52 image models and 29 video models on
 * the day this was written - and a hand-kept copy would be stale before it
 * was committed. So a connection that serves OpenRouter's media wire reads
 * the four listings OpenRouter publishes, without a key, and the answer is
 * cached for an hour per base URL: long enough that a settings screen does
 * not fetch four listings on every paint, short enough that a model released
 * this morning is there this afternoon.
 *
 * Offline, or with the listings unreachable, the answer is empty and the
 * declared catalog stands; nothing here throws into a settings screen. No
 * pricing is read: audio, image and video are priced per second, per image
 * and per character across vendors, and there is no honest single number
 * to print - the plan's decision, and the reason `pricing` stays unknown.
 */

interface Listing {
  readonly at: number;
  readonly models: readonly CatalogSourceModel[];
}

const CACHE_TTL_MS = 60 * 60 * 1_000;
const LISTING_TIMEOUT_MS = 10_000;

const cache = new Map<string, Listing>();

/** Injectable for tests: the fetch of one listing URL, answering its JSON text. */
export type ListingFetch = (url: string) => Promise<string>;

const defaultFetch: ListingFetch = async (url) => {
  const answered = await requestDirect({
    url,
    author: "user",
    method: "GET",
    headers: { accept: "application/json" },
    timeoutMs: LISTING_TIMEOUT_MS,
  });
  if (answered.status >= 400) {
    throw new MediaError("provider-refused", `OpenRouter answered ${String(answered.status)} to the listing.`);
  }
  return answered.body;
};

const UNKNOWN_PRICING = {
  input: "unknown",
  output: "unknown",
  cacheRead: "unknown",
  cacheWrite: "unknown",
} as const;

function capabilityFor(
  earned: Partial<ModelCapability>,
): ModelCapability {
  return {
    textGeneration: "unsupported",
    streaming: "unknown",
    reasoning: "unsupported",
    toolCalling: "unsupported",
    vision: "unknown",
    embeddings: "unsupported",
    reranking: "unsupported",
    imageGeneration: "unsupported",
    imageEditing: "unsupported",
    videoGeneration: "unsupported",
    speechGeneration: "unsupported",
    transcription: "unsupported",
    webSearch: "unsupported",
    webFetch: "unsupported",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
    ...earned,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entries(json: string): readonly Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || !Array.isArray(parsed.data)) return [];
    return parsed.data.filter(isRecord);
  } catch {
    return [];
  }
}

function model(
  entry: Record<string, unknown>,
  earned: Partial<ModelCapability>,
  shape: CatalogSourceModel["shape"],
): CatalogSourceModel | undefined {
  if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
  return {
    modelId: entry.id,
    displayName: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
    capability: capabilityFor(earned),
    reasoningLevels: [],
    shape,
    pricing: UNKNOWN_PRICING,
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

async function listing(
  url: string,
  fetchListing: ListingFetch,
  map: (entry: Record<string, unknown>) => CatalogSourceModel | undefined,
): Promise<readonly CatalogSourceModel[]> {
  try {
    return entries(await fetchListing(url)).flatMap((entry) => {
      const mapped = map(entry);
      return mapped === undefined ? [] : [mapped];
    });
  } catch {
    return [];
  }
}

export async function openrouterMediaModels(
  baseUrl: string,
  options: { readonly fetch?: ListingFetch; readonly now?: () => number } = {},
): Promise<readonly CatalogSourceModel[]> {
  const now = options.now ?? (() => Date.now());
  const origin = baseUrl.replace(/\/+$/, "");
  const cached = cache.get(origin);
  if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) return cached.models;

  const fetchListing = options.fetch ?? defaultFetch;
  const [speech, transcription, images, videos] = await Promise.all([
    listing(`${origin}/models?output_modalities=speech`, fetchListing, (entry) =>
      model(entry, { speechGeneration: "supported" }, "sync"),
    ),
    listing(`${origin}/models?output_modalities=transcription`, fetchListing, (entry) =>
      model(entry, { transcription: "supported" }, "sync"),
    ),
    listing(`${origin}/images/models`, fetchListing, (entry) =>
      model(
        entry,
        {
          imageGeneration: "supported",
          ...(takesInputImages(entry)
            ? { imageEditing: "supported" as const, vision: "supported" as const }
            : {}),
        },
        "sync",
      ),
    ),
    listing(`${origin}/videos/models`, fetchListing, (entry) =>
      model(entry, { videoGeneration: "supported" }, "poll"),
    ),
  ]);

  const models = [...speech, ...transcription, ...images, ...videos];
  // An empty answer is not cached: it is what "offline" looks like, and the
  // next paint should ask again rather than show nothing for an hour.
  if (models.length > 0) cache.set(origin, { at: now(), models });
  return models;
}

/** For tests. */
export function forgetOpenrouterListings(): void {
  cache.clear();
}
