import type { ModelPricing } from "../../../../core/capabilities";

export const UNKNOWN_GOOGLE_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Gemini model discovery does not provide pricing."
};

export function getGoogleModelPricing(): ModelPricing {
  return UNKNOWN_GOOGLE_PRICE;
}

