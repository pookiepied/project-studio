import type { ModelPricing } from "../../../../core/capabilities";

// MiniMax's OpenAI-compatible surface does not return per-token pricing, and the gateway
// keeps no static MiniMax price table (prices vary by model and are not verifiable from
// here). Per GATEWAY_GUIDE §6 "pricing honesty" — unknown price is null / N/A, never invented.
export const UNKNOWN_MINIMAX_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "MiniMax does not expose pricing via the API; no static price on record."
};

export function getMinimaxModelPricing(): ModelPricing {
  return UNKNOWN_MINIMAX_PRICE;
}
