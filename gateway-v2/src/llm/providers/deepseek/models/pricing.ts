import type { ModelPricing } from "../../../../core/capabilities";

// DeepSeek's live /models endpoint returns model IDs but NO pricing. Pricing is applied
// from this static table. Verified against https://api-docs.deepseek.com/quick_start/pricing
// (as of 2026-07-05). Prices are USD per 1M tokens; cache-hit input is discounted.
const PRICING_VERIFIED_NOTE =
  "Static DeepSeek pricing; verified against https://api-docs.deepseek.com/quick_start/pricing (as of 2026-07-05). Cache-hit input is discounted; cache-miss input shown.";

export const UNKNOWN_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "DeepSeek /models does not include pricing; no static price on record for this model."
};

// USD per 1M tokens (cache-miss input). The V4 lineup is priced per-model; the legacy
// deepseek-chat / deepseek-reasoner aliases map to the V4-flash tiers. Matched
// longest-first at a segment boundary.
const STATIC_PRICING: Array<{ key: string; pricing: ModelPricing }> = [
  {
    key: "deepseek-v4-pro",
    pricing: { inputPerMillionUsd: 0.435, outputPerMillionUsd: 0.87, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "deepseek-v4-flash",
    pricing: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  // Legacy aliases (deprecated 2026/07/24) — map to V4-flash tiers for continuity.
  {
    key: "deepseek-chat",
    pricing: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "deepseek-reasoner",
    pricing: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "deepseek-r1",
    pricing: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, source: "static", note: PRICING_VERIFIED_NOTE }
  }
];

export function getDeepSeekModelPricing(modelId: string): ModelPricing {
  const lower = modelId.toLowerCase();
  // Longest-key-first: the most specific tier wins.
  const sorted = [...STATIC_PRICING].sort((a, b) => b.key.length - a.key.length);
  for (const entry of sorted) {
    if (lower === entry.key || lower.startsWith(`${entry.key}-`)) {
      return entry.pricing;
    }
  }
  return UNKNOWN_PRICE;
}
