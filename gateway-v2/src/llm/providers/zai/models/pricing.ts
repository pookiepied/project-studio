import type { ModelPricing } from "../../../../core/capabilities";

// Z.AI's OpenAI-compatible surface does not return per-token pricing via the API, and the
// gateway keeps no static GLM price table (published prices are marketing-page figures, not
// API-verifiable). Per GATEWAY_GUIDE §6 "pricing honesty" — unknown price is null / N/A,
// never invented.
export const UNKNOWN_ZAI_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Z.AI does not expose pricing via the API; no static price on record."
};

export function getZaiModelPricing(): ModelPricing {
  return UNKNOWN_ZAI_PRICE;
}
