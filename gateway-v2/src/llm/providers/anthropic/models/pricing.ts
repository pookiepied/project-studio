import type { ModelPricing } from "../../../../core/capabilities";

// USD per 1,000,000 tokens. As of 2026-06-24.
// Source: Anthropic pricing / model catalog (https://www.anthropic.com/pricing and the
// Anthropic model docs). Anthropic's /v1/models endpoint does NOT return pricing, so
// these are maintained as clearly-marked static constants and must be re-verified during
// pricing reviews.
const STATIC_PRICING_NOTE = "Static Anthropic pricing (per 1M tokens) as of 2026-06-24; verify during pricing reviews.";

export const UNKNOWN_ANTHROPIC_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Anthropic /v1/models does not include pricing; no reviewed static price for this model."
};

const STATIC_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": staticPrice(10, 50),
  "claude-opus-4-8": staticPrice(5, 25),
  "claude-opus-4-7": staticPrice(5, 25),
  "claude-opus-4-6": staticPrice(5, 25),
  "claude-opus-4-5": staticPrice(5, 25),
  "claude-sonnet-5": staticPrice(
    3,
    15,
    "Standard pricing per 1M tokens; introductory $2 in / $10 out runs through 2026-08-31. Verify during pricing reviews."
  ),
  "claude-sonnet-4-6": staticPrice(3, 15),
  "claude-sonnet-4-5": staticPrice(3, 15),
  "claude-haiku-4-5": staticPrice(1, 5)
};

function staticPrice(inputPerMillionUsd: number, outputPerMillionUsd: number, note = STATIC_PRICING_NOTE): ModelPricing {
  return { inputPerMillionUsd, outputPerMillionUsd, source: "static", note };
}

export function getAnthropicModelPricing(modelId: string): ModelPricing {
  return STATIC_PRICING[stripDateSuffix(modelId)] ?? STATIC_PRICING[modelId] ?? UNKNOWN_ANTHROPIC_PRICE;
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}
