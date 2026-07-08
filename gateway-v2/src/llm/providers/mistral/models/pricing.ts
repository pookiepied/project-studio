import type { ModelPricing } from "../../../../core/capabilities";

// Mistral's live /v1/models endpoint returns model IDs but NO pricing, and the gateway does
// not maintain a static Mistral price table (prices vary by model and are not verifiable from
// here). Per GATEWAY_GUIDE §6 "pricing honesty" — an unknown price is reported as null / N/A,
// never invented.
export const UNKNOWN_MISTRAL_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Mistral /v1/models does not include pricing; no static price on record for this model."
};

export function getMistralModelPricing(): ModelPricing {
  return UNKNOWN_MISTRAL_PRICE;
}
