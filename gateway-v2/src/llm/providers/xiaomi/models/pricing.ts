import type { ModelPricing } from "../../../../core/capabilities";

// Xiaomi MiMo's OpenAI-compatible surface does not return per-token pricing, and the gateway
// keeps no static MiMo price table (tiered pricing is not verifiable from the API). Per
// GATEWAY_GUIDE §6 "pricing honesty" — unknown price is null / N/A, never invented.
export const UNKNOWN_XIAOMI_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Xiaomi MiMo does not expose pricing via the API; no static price on record."
};

export function getXiaomiModelPricing(): ModelPricing {
  return UNKNOWN_XIAOMI_PRICE;
}
