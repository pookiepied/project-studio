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
 * Google's catalogue, read live from the Gemini API's model list.
 *
 * The connection's base URL already carries the version - the declared
 * catalog's words - so the listing is one page more: `/models` beside it.
 * The key rides `x-goog-api-key`, the same header the probe uses, and like
 * ElevenLabs there is no anonymous read: no key, no list, and the vendor's
 * 403 becomes the shared machinery's nothing.
 *
 * Two classifications, both the vendor's own words (the plan's):
 *
 * - `supportedGenerationMethods` naming `predictLongRunning` is a video
 *   model - the long-running operation the adapter already drives, submit
 *   then poll. The Imagen family retired in August, so today this catches
 *   exactly Veo; if a future answerer of that method is not video, the
 *   number this read logs will be the first to say so.
 * - otherwise, a model whose id names `-image` and which answers
 *   `generateContent` is an image model: generation, editing, and vision,
 *   because every Gemini image model takes the input image it edits. (The
 *   id, not a flag: the list carries no output-modality field, and the
 *   `-image` suffix is how the vendor spells "this one makes pictures".)
 *
 * Everything else - the chat models, TTS, embeddings - the declared catalog
 * and the language gateway already answer for; those entries are counted.
 *
 * The list is paged (the vendor's default page is far smaller than the
 * catalogue), so the read asks for a full thousand and follows
 * `nextPageToken` while it comes.
 */

/** How many answers one page asks for: the documented maximum, so the catalogue is one read when it fits. */
const GOOGLE_PAGE_SIZE = 1000;

/** A wedged `nextPageToken` must not read forever. */
const GOOGLE_PAGE_CEILING = 10;

interface GooglePage {
  readonly models: readonly Record<string, unknown>[];
  readonly nextToken: string | undefined;
}

function pageOf(json: string): GooglePage {
  const parsed = parseListingAnswer(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new MediaError(
      "provider-refused",
      "Google answered its listing outside its documented shape.",
    );
  }
  return {
    models: parsed.models.filter(isRecord),
    nextToken: typeof parsed.nextPageToken === "string" ? parsed.nextPageToken : undefined,
  };
}

function entryModel(entry: Record<string, unknown>): CatalogSourceModel | "dropped" | undefined {
  const name = entry.name;
  if (typeof name !== "string" || name.length === 0) return undefined;
  // The vendor spells its ids with a `models/` prefix; the catalogue's, the
  // declared catalog's, and the probe's spelling of the same model are bare.
  const modelId = name.startsWith("models/") ? name.slice("models/".length) : name;
  const methods = entry.supportedGenerationMethods;
  if (!Array.isArray(methods)) return "dropped";
  const displayName =
    typeof entry.displayName === "string" && entry.displayName.length > 0
      ? entry.displayName
      : modelId;

  if (methods.includes("predictLongRunning")) {
    return {
      modelId,
      displayName,
      capability: capabilityFor({ videoGeneration: "supported" }),
      reasoningLevels: [],
      featured: false,
      // Long-running: the request returns a name to poll, not a video.
      shape: "poll",
      pricing: UNKNOWN_MODEL_PRICING,
    };
  }

  if (methods.includes("generateContent") && typeof modelId === "string" && modelId.includes("-image")) {
    return {
      modelId,
      displayName,
      capability: capabilityFor({
        imageGeneration: "supported",
        imageEditing: "supported",
        vision: "supported",
      }),
      reasoningLevels: [],
      featured: false,
      shape: "sync",
      pricing: UNKNOWN_MODEL_PRICING,
    };
  }

  return "dropped";
}

export const googleListing: MediaListing = createMediaListing({
  vendor: "Google",
  read: async ({ origin, credential, fetch }) => {
    const models: CatalogSourceModel[] = [];
    let dropped = 0;
    let token: string | undefined = undefined;

    for (let page = 0; page < GOOGLE_PAGE_CEILING; page += 1) {
      const query = token === undefined ? `?pageSize=${String(GOOGLE_PAGE_SIZE)}` : `?pageSize=${String(GOOGLE_PAGE_SIZE)}&pageToken=${encodeURIComponent(token)}`;
      const answered = pageOf(
        await fetch(`${origin}/models${query}`, {
          ...(credential === undefined ? {} : { "x-goog-api-key": credential }),
        }),
      );
      for (const entry of answered.models) {
        const classified = entryModel(entry);
        if (classified === "dropped") {
          dropped += 1;
          continue;
        }
        if (classified !== undefined) models.push(classified);
      }
      if (answered.nextToken === undefined) return { models, dropped };
      token = answered.nextToken;
    }
    return { models, dropped };
  },
});
