import type { ModelPricing } from "../../../../core/capabilities";

// DashScope's OpenAI-compatible surface does not return per-token pricing, and the gateway
// keeps no static Qwen price table (prices vary by model/region and are not verifiable from
// here). Per GATEWAY_GUIDE §6 "pricing honesty" — unknown price is null / N/A, never invented.
export const UNKNOWN_ALIBABA_PRICE: ModelPricing = {
  inputPerMillionUsd: null,
  outputPerMillionUsd: null,
  source: "unknown",
  note: "Alibaba Model Studio does not expose pricing via the API; no static price on record."
};

export function getAlibabaModelPricing(): ModelPricing {
  return UNKNOWN_ALIBABA_PRICE;
}
