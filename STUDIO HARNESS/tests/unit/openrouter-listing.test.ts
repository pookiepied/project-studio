import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetOpenrouterListings,
  openrouterMediaModels,
} from "../../src/gateway/catalog/openrouter-media.js";

/**
 * OpenRouter's live media listing, read through an injected fetch: the five
 * endpoints, what each model earns, the hour's cache, and the empty answer
 * when the vendor is unreachable.
 */

const LISTINGS: Readonly<Record<string, unknown>> = {
  "https://openrouter.ai/api/v1/models?output_modalities=speech": {
    data: [{ id: "fish-audio/s2.1-pro", name: "Fish Audio: S2.1 Pro" }],
  },
  "https://openrouter.ai/api/v1/models?output_modalities=transcription": {
    data: [{ id: "deepgram/nova-3", name: "Deepgram: Nova 3" }],
  },
  "https://openrouter.ai/api/v1/models?input_modalities=file": {
    data: [{ id: "google/gemini-3.1-pro", name: "Google: Gemini 3.1 Pro" }],
  },
  "https://openrouter.ai/api/v1/images/models": {
    data: [
      {
        id: "openai/gpt-image-2.5-sunburst",
        name: "OpenAI: GPT Image 2.5 Sunburst",
        supported_parameters: { input_references: { type: "range", min: 0, max: 16 } },
      },
      { id: "krea/krea-2-medium", name: "Krea 2 Medium", supported_parameters: {} },
    ],
  },
  "https://openrouter.ai/api/v1/videos/models": {
    data: [{ id: "google/veo-3.1", name: "Google: Veo 3.1" }],
  },
};

let fetched: string[];

function fetchListing(url: string): Promise<string> {
  fetched.push(url);
  const listing = LISTINGS[url];
  if (listing === undefined) return Promise.reject(new Error(`unexpected ${url}`));
  return Promise.resolve(JSON.stringify(listing));
}

beforeEach(() => {
  forgetOpenrouterListings();
  fetched = [];
});

describe("OpenRouter's live media listing", () => {
  it("retains valid built-in voice IDs without inventing a voice for other models", async () => {
    const models = await openrouterMediaModels("https://voices.test/api/v1", { fetch: async (url) => JSON.stringify({
      data: url.endsWith("=speech") ? [
        { id: "hexgrad/kokoro-82m", supported_voices: [null, "", "af_alloy", 3, "af_heart"] },
        { id: "provider/default-voice", supported_voices: null },
      ] : [],
    }) });
    expect(models.find((model) => model.modelId === "hexgrad/kokoro-82m")).toMatchObject({ voiceIds: ["af_alloy", "af_heart"] });
    expect(models.find((model) => model.modelId === "provider/default-voice")).not.toHaveProperty("voiceIds");
  });
  it("reads the five listings and tags each model with the slot it serves", async () => {
    const models = await openrouterMediaModels("https://openrouter.ai/api/v1/", { fetch: fetchListing });
    expect(fetched).toHaveLength(5);
    const byId = new Map(models.map((model) => [model.modelId, model]));

    expect(byId.get("fish-audio/s2.1-pro")?.capability.speechGeneration).toBe("supported");
    expect(byId.get("fish-audio/s2.1-pro")?.capability.textGeneration).toBe("unsupported");
    expect(byId.get("deepgram/nova-3")?.capability.transcription).toBe("supported");
    // A chat model that takes a file reads documents; the listing says so
    // per model, and nothing else about it is promised here.
    expect(byId.get("google/gemini-3.1-pro")?.capability.documentReading).toBe("supported");
    expect(byId.get("google/gemini-3.1-pro")?.capability.textGeneration).toBe("unsupported");
    // An image model that takes input references earns editing; one that
    // does not stays a generator.
    expect(byId.get("openai/gpt-image-2.5-sunburst")?.capability.imageEditing).toBe("supported");
    expect(byId.get("krea/krea-2-medium")?.capability.imageGeneration).toBe("supported");
    expect(byId.get("krea/krea-2-medium")?.capability.imageEditing).toBe("unsupported");
    expect(byId.get("google/veo-3.1")?.shape).toBe("poll");
    expect(byId.get("google/veo-3.1")?.displayName).toBe("Google: Veo 3.1");
    expect(models.every((model) => model.pricing.input === "unknown")).toBe(true);
  });

  it("answers from the cache for an hour, then asks again", async () => {
    let now = 1_000;
    await openrouterMediaModels("https://openrouter.ai/api/v1", { fetch: fetchListing, now: () => now });
    await openrouterMediaModels("https://openrouter.ai/api/v1", { fetch: fetchListing, now: () => now });
    expect(fetched).toHaveLength(5);
    now += 61 * 60 * 1_000;
    await openrouterMediaModels("https://openrouter.ai/api/v1", { fetch: fetchListing, now: () => now });
    expect(fetched).toHaveLength(10);
  });

  it("answers nothing offline, and does not cache the nothing", async () => {
    const failing = () => Promise.reject(new Error("offline"));
    expect(await openrouterMediaModels("https://openrouter.ai/api/v1", { fetch: failing })).toEqual([]);
    const models = await openrouterMediaModels("https://openrouter.ai/api/v1", { fetch: fetchListing });
    expect(models.length).toBe(6);
  });
});
