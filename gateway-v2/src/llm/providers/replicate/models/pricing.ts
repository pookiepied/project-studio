import type { ModelPricing } from "../../../../core/capabilities";

// Replicate bills by model run-time (per second of hardware) and does not expose a
// machine-readable per-token price list, so pricing is reported as unknown rather than
// invented (GATEWAY_GUIDE §6 "pricing honesty").
export const UNKNOWN_REPLICATE_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Replicate bills per run-second; not a token-priced model and exposes no price list."
};

export function getReplicateModelPricing(): ModelPricing {
  return UNKNOWN_REPLICATE_PRICE;
}
