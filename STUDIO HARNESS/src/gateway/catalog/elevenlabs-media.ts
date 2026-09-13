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
 * ElevenLabs' catalogue, read live.
 *
 * Unlike every other vendor here, the connection's own base URL *is* the
 * listing's home - `https://api.elevenlabs.io/v1`, where `/models` answers
 * beside the speech routes. There is no second host, no paging, and no
 * anonymous read: the key that speaks the media wire speaks this too, riding
 * the vendor's own `xi-api-key` header, and a connection without one gets
 * the vendor's 401, which the shared machinery answers with nothing, because
 * that is what "the vendor did not answer" looks like.
 *
 * The answer is a bare JSON array of model records, and the plan's
 * classification is one flag: `can_do_text_to_speech` earns the speech slot.
 * Everything else in the answer - Scribe, the older flags - stays with the
 * declared catalog, which already names the transcription models; the count
 * of what the listing did not classify is the shared machinery's to log.
 */

function entryModel(entry: Record<string, unknown>): CatalogSourceModel | "dropped" | undefined {
  const modelId = entry.model_id;
  if (typeof modelId !== "string" || modelId.length === 0) return undefined;
  if (entry.can_do_text_to_speech !== true) return "dropped";
  const displayName =
    typeof entry.name === "string" && entry.name.length > 0 ? entry.name : modelId;
  const earned: Partial<ModelCapability> = { speechGeneration: "supported" };
  return {
    modelId,
    displayName,
    capability: capabilityFor(earned),
    reasoningLevels: [],
    // The featured shelf is the declared catalog's word about the few; a
    // vendor that lists nothing but its own ids features nothing itself.
    featured: false,
    // Speech synthesis here is one synchronous round trip.
    shape: "sync",
    pricing: UNKNOWN_MODEL_PRICING,
  };
}

export const elevenlabsListing: MediaListing = createMediaListing({
  vendor: "ElevenLabs",
  read: async ({ origin, credential, fetch }) => {
    const answered = parseListingAnswer(
      await fetch(`${origin}/models`, {
        ...(credential === undefined ? {} : { "xi-api-key": credential }),
      }),
    );
    if (!Array.isArray(answered)) {
      throw new MediaError(
        "provider-refused",
        "ElevenLabs answered its listing outside its documented shape.",
      );
    }
    const models: CatalogSourceModel[] = [];
    let dropped = 0;
    for (const value of answered) {
      if (!isRecord(value)) continue;
      const classified = entryModel(value);
      if (classified === "dropped") {
        dropped += 1;
        continue;
      }
      if (classified !== undefined) models.push(classified);
    }
    return { models, dropped };
  },
});
