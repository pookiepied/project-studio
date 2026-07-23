import type { ProviderId } from "@/domain/contracts";
import type { ModelPricing } from "@/domain/models/capabilities";
import type { RegistryCategory, RegistryPricing } from "./schema";
import { SOURCES } from "./metadata";
import { verifiedPricingFor } from "./reviewedPricing";

export function legacyPricing(pricing: RegistryPricing): ModelPricing {
  if (pricing.kind === "token" || pricing.kind === "embedding") {
    return {
      inputPerMillionUsd: pricing.inputPerMillion ?? null,
      outputPerMillionUsd: pricing.outputPerMillion ?? null,
      source: pricing.status === "verified" ? "static" : "unknown",
      note: pricing.notes
    };
  }
  return {
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    source: "unknown",
    note: pricing.notes
  };
}

export function pricingFor(provider: ProviderId, category: RegistryCategory, modelId?: string): RegistryPricing {
  const override = modelId ? verifiedPricingFor(modelId) : undefined;
  if (override) return override;
  const sourceUrls = SOURCES[provider];
  if (category === "text.chat") {
    return {
      kind: "token",
      status: "unknown",
      currency: "USD",
      billingUnit: "one_million_tokens",
      inputPerMillion: null,
      cachedInputPerMillion: null,
      cacheWritePerMillion: null,
      outputPerMillion: null,
      batchInputPerMillion: null,
      batchOutputPerMillion: null,
      reasoningTokens: "unknown",
      sourceUrls,
      verifiedAt: null,
      notes: "N/A until this exact provider route is verified from official pricing or tested billing data."
    };
  }
  if (category === "embeddings") {
    return {
      kind: "embedding",
      status: "unknown",
      currency: "USD",
      billingUnit: "one_million_tokens",
      inputPerMillion: null,
      outputPerMillion: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Embedding pricing is token based; this exact route price is not verified in the curated registry yet."
    };
  }
  if (category === "image.generation" || category === "image.editing") {
    return {
      kind: "image",
      status: provider === "replicate" || provider === "fal" ? "provider_variable" : "unknown",
      currency: "USD",
      billingUnit: provider === "replicate" ? "prediction" : "image",
      price: null,
      dependsOn: provider === "replicate" || provider === "fal"
        ? ["resolution", "quality", "provider_route", "hardware"]
        : ["resolution", "quality"],
      sourceUrls,
      verifiedAt: null,
      notes: "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
    };
  }
  if (category === "video.generation") {
    return {
      kind: "video",
      status: provider === "replicate" || provider === "fal" ? "provider_variable" : "unknown",
      currency: "USD",
      billingUnit: provider === "replicate" ? "prediction" : "video_second",
      price: null,
      dependsOn: ["duration", "resolution", "fps", "quality", "provider_route", "hardware"],
      sourceUrls,
      verifiedAt: null,
      notes: "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
    };
  }
  if (category === "audio.speech") {
    return {
      kind: "audio",
      status: "unknown",
      currency: "USD",
      billingUnit: provider === "elevenlabs" ? "character" : "audio_minute",
      price: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Speech pricing must preserve provider units such as character, credit, minute, or generation."
    };
  }
  if (category === "audio.transcription") {
    return {
      kind: "audio",
      status: "unknown",
      currency: "USD",
      billingUnit: provider === "groq" ? "audio_hour" : "audio_minute",
      price: null,
      sourceUrls,
      verifiedAt: null,
      notes: "Transcription pricing is duration based for most supported providers."
    };
  }
  return {
    kind: "custom",
    status: "not_applicable",
    currency: "USD",
    billingUnit: "not_applicable",
    price: null,
    sourceUrls,
    verifiedAt: null
  };
}
