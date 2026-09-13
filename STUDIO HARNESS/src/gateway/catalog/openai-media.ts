import type { ModelCapability } from "../../contracts/models.js";
import {
  capabilityFor,
  createMediaListing,
  dataEntries,
  UNKNOWN_MODEL_PRICING,
  type MediaListing,
} from "./media-listing.js";
import type { CatalogSourceModel } from "./index.js";

/**
 * OpenAI's media models, read live from the same `/v1/models` that answers
 * for the connection's chat half.
 *
 * One answer, two vocabularies: the list carries every model the key can
 * see, and the plan's rule reads the FAMILY off the id, because OpenAI
 * carries no capability flag, no category, no supported methods - the ids
 * are the metadata. `gpt-image-*` paints and, its edits endpoint being the
 * same family, edits; anything breathing `tts` speaks; `transcribe` and
 * `whisper-*` hear; `text-embedding-*` embeds. Everything else in the
 * answer is the language gateway's business - Pi's chat models, joined
 * beside these - and is counted, not classified. The families are disjoint
 * in the ids OpenAI ships today; when one stops being, the log line's
 * number is where the surprise lands first.
 *
 * The connection's base URL is the listing's home, the credential rides the
 * bearer header the chat half already uses, and there is no anonymous read:
 * no key, no list.
 */

function familyOf(id: string): Partial<ModelCapability> | undefined {
  if (id.startsWith("gpt-image-")) {
    // Every model in the family returns base64 and takes input images on
    // the edits endpoint, which is what earns editing - and seeing, which
    // editing needs. The reasoning is the declared catalog's; the ids here
    // are the vendor's own, spoken live.
    return { imageGeneration: "supported", imageEditing: "supported", vision: "supported" };
  }
  if (id.includes("tts")) return { speechGeneration: "supported" };
  if (id.includes("transcribe") || id.startsWith("whisper-")) {
    return { transcription: "supported" };
  }
  if (id.startsWith("text-embedding-")) return { embeddings: "supported" };
  return undefined;
}

export const openaiListing: MediaListing = createMediaListing({
  vendor: "OpenAI",
  read: async ({ origin, credential, fetch }) => {
    // A body outside this shape reads as an empty data array: to the shared
    // machinery, the same nothing a refusal answers - uncached, asked again.
    // The next paint tells the two apart by succeeding, which is enough; the
    // shape-strict readers (ElevenLabs, Google) throw instead, and their
    // refusal names the vendor. One difference, said once, here.
    const entries = dataEntries(
      await fetch(`${origin}/models`, {
        ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
      }),
    );

    const models: CatalogSourceModel[] = [];
    let dropped = 0;
    for (const entry of entries) {
      const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : undefined;
      if (id === undefined) continue;
      const earned = familyOf(id);
      if (earned === undefined) {
        dropped += 1;
        continue;
      }
      models.push({
        // The list carries no display name; the id is the vendor's own word.
        modelId: id,
        displayName: id,
        capability: capabilityFor(earned),
        reasoningLevels: [],
        featured: false,
        // Images, speech and embeddings are one synchronous round trip.
        shape: "sync",
        pricing: UNKNOWN_MODEL_PRICING,
      });
    }
    return { models, dropped };
  },
});
