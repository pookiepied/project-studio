import type { ModelPricing } from "../../../../core/capabilities";

// Fal prices per-model (per image / per second of video / per second of audio) and does not
// expose a machine-readable price list, so the gateway reports pricing as unknown rather than
// inventing a number (GATEWAY_GUIDE §6 "pricing honesty").
export const UNKNOWN_FAL_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Fal bills per-image / per-second and exposes no price list; not a token-priced model."
};

export function getFalModelPricing(): ModelPricing {
  return UNKNOWN_FAL_PRICE;
}
