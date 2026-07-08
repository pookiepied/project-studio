import type { ModelPricing } from "../../../../core/capabilities";

const STATIC_PRICING_NOTE = "Static OpenAI pricing maintained in gateway-v2; verify during pricing reviews.";

export const UNKNOWN_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "OpenAI /v1/models does not include pricing."
};

const STATIC_PRICING: Record<string, ModelPricing> = {
  "gpt-5": {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-5-mini": {
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 2,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-5-nano": {
    inputPerMillionUsd: 0.05,
    outputPerMillionUsd: 0.4,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-4.1": {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 8,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-4.1-mini": {
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-4.1-nano": {
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.4,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-4o": {
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
    source: "static",
    note: STATIC_PRICING_NOTE
  },
  "gpt-4o-mini": {
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    source: "static",
    note: STATIC_PRICING_NOTE
  }
};

export function getOpenAIModelPricing(modelId: string): ModelPricing {
  return STATIC_PRICING[modelId] ?? UNKNOWN_PRICE;
}

