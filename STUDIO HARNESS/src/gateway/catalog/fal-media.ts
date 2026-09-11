import type { ModelCapability } from "../../contracts/models.js";
import { MediaError } from "../../contracts/media.js";
import {
  capabilityFor,
  createMediaListing,
  isRecord,
  parseListingAnswer,
  UNKNOWN_MODEL_PRICING,
  type MediaListing,
} from "./media-listing.js";
import type { CatalogSourceModel } from "./index.js";

/**
 * FAL's catalogue, read live from its API host.
 *
 * FAL is an aggregator whose queue speaks one wire for every model, so its
 * adapter already drives any endpoint id - the catalogue was the whole gap,
 * and the listing closes it. The catalogue lives on `api.fal.ai`, not on the
 * queue host the connection's base URL names (`queue.fal.run` answers 405 to
 * a GET, the probe learned this first), which is why the read ignores the
 * connection's origin and names the API host itself: the base URL is where
 * generations go, the listing is where the vendor's own word about what
 * exists is.
 *
 * The listing is paged: 500 answers a page, the answer carries a cursor and
 * has_more, and 1500 models were 3 pages on the day this was read. Auth is
 * the vendor's own `Key` prefix, and a connection without a stored key
 * reads anyway - the catalogue is public; a wrong key, not the absent one,
 * is what 401 means here. Every category the vendor names that a Studio slot
 * answers is classified; the rest are counted and logged, not listed (the
 * plan's second decision), which is how the next slot's decision reads a
 * number rather than a feeling.
 *
 * Like every live listing, this reads but does not show prices: FAL's answer
 * carries them, the reasons they go no further live in `media-listing.ts`.
 */

/** FAL's API host: the listing's home, beside the queue host the probe already reached. */
const FAL_LISTING_HOST = "https://api.fal.ai";

/** How many answers one page asks for. 500 was honoured whole; three pages covered the catalogue. */
const FAL_PAGE_LIMIT = 500;

/** A broken cursor must not read forever; ten pages is twenty times the catalogue's first measure. */
const FAL_PAGE_CEILING = 10;

/** The categories FAL names that a Studio slot answers, and what each earns. */
const CATEGORY_SLOTS: Readonly<Record<string, Partial<ModelCapability>>> = {
  "text-to-image": { imageGeneration: "supported" },
  // An image-to-image model takes an input image, which is what earns
  // editing - and seeing, as it must see what it edits. The same reasoning
  // that earned vision for OpenRouter's editable image models.
  "image-to-image": {
    imageGeneration: "supported",
    imageEditing: "supported",
    vision: "supported",
  },
  // Image-to-video is video generation: the video tool already takes an
  // input image, which is the plan's own note.
  "text-to-video": { videoGeneration: "supported" },
  "image-to-video": { videoGeneration: "supported" },
  "text-to-speech": { speechGeneration: "supported" },
  "speech-to-text": { transcription: "supported" },
};

/** The credential rides the vendor's own `Key` scheme, in the outbound header alone. */
function falHeaders(credential: string | undefined): Record<string, string> {
  return credential === undefined ? {} : { authorization: `Key ${credential}` };
}

function entryModel(
  entry: Record<string, unknown>,
): CatalogSourceModel | "dropped" | undefined {
  const endpointId = entry.endpoint_id;
  if (typeof endpointId !== "string" || endpointId.length === 0) return undefined;
  const metadata = entry.metadata;
  const category =
    isRecord(metadata) && typeof metadata.category === "string" ? metadata.category : undefined;
  const earned = category === undefined ? undefined : CATEGORY_SLOTS[category];
  if (earned === undefined) return "dropped";
  const displayName =
    isRecord(metadata) &&
    typeof metadata.display_name === "string" &&
    metadata.display_name.length > 0
      ? metadata.display_name
      : endpointId;
  return {
    modelId: endpointId,
    displayName,
    capability: capabilityFor(earned),
    reasoningLevels: [],
    // The featured shelf is the declared catalog's word about the few, and
    // nothing the vendor lists features by itself.
    featured: false,
    // Every FAL model answers through the queue: submit, then poll.
    shape: "poll",
    pricing: UNKNOWN_MODEL_PRICING,
  };
}

/** One page, as the vendor answers it. */
interface FalPage {
  readonly models: readonly Record<string, unknown>[];
  readonly hasMore: boolean;
  readonly nextCursor: string | undefined;
}

function pageOf(json: string): FalPage {
  const parsed = parseListingAnswer(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    // Not the vendor's documented shape: the read fails, which is what keeps
    // a half-catalogue from being cached as though it were whole.
    throw new MediaError(
      "provider-refused",
      "FAL answered its listing outside its documented shape.",
    );
  }
  return {
    models: parsed.models.filter(isRecord),
    hasMore: parsed.has_more === true,
    nextCursor: typeof parsed.next_cursor === "string" ? parsed.next_cursor : undefined,
  };
}

export const falListing: MediaListing = createMediaListing({
  vendor: "FAL",
  read: async ({ credential, fetch }) => {
    const models: CatalogSourceModel[] = [];
    let dropped = 0;
    let cursor: string | undefined = undefined;

    for (let page = 0; page < FAL_PAGE_CEILING; page += 1) {
      const query =
        cursor === undefined
          ? `?limit=${String(FAL_PAGE_LIMIT)}`
          : `?limit=${String(FAL_PAGE_LIMIT)}&cursor=${encodeURIComponent(cursor)}`;
      const answered = pageOf(await fetch(`${FAL_LISTING_HOST}/v1/models${query}`, falHeaders(credential)));
      for (const entry of answered.models) {
        const classified = entryModel(entry);
        if (classified === "dropped") {
          dropped += 1;
          continue;
        }
        if (classified !== undefined) models.push(classified);
      }
      if (!answered.hasMore || answered.nextCursor === undefined) return { models, dropped };
      cursor = answered.nextCursor;
    }
    // The ceiling exists for a wedged cursor. A vendor that lists ten
    // thousand models needs the ceiling raised by a person, not a loop.
    return { models, dropped };
  },
});
