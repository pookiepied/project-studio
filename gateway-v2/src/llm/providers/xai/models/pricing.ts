import type { ModelPricing } from "../../../../core/capabilities";

// xAI's live /v1/models endpoint returns model IDs but NO pricing. Pricing is applied
// from this static table. Verified against https://docs.x.ai/docs/models (as of 2026-07-05).
const PRICING_VERIFIED_NOTE =
  "Static xAI pricing; verified against https://docs.x.ai/docs/models (as of 2026-07-05).";

export const UNKNOWN_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "xAI /v1/models does not include pricing; no static price on record for this model."
};

// USD per 1M tokens. Matched longest-first at a segment boundary so dated variants
// (grok-4.20-0309-reasoning) and aliases (grok-4.20-reasoning) alike resolve to the
// correct tier. The current Grok chat lineup is uniformly $1.25 in / $2.50 out per 1M.
const STATIC_PRICING: Array<{ key: string; pricing: ModelPricing }> = [
  {
    key: "grok-4.20-multi-agent-0309",
    pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 2.5, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "grok-4.20-0309-non-reasoning",
    pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 2.5, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "grok-4.20-0309-reasoning",
    pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 2.5, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "grok-4.20",
    pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 2.5, source: "static", note: PRICING_VERIFIED_NOTE }
  },
  {
    key: "grok-4.3",
    pricing: { inputPerMillionUsd: 1.25, outputPerMillionUsd: 2.5, source: "static", note: PRICING_VERIFIED_NOTE }
  }
];

export function getXaiModelPricing(modelId: string): ModelPricing {
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
