import type { ModelPricing } from "../../../../core/capabilities";
import type { OpenRouterApiModel } from "./discovery";

// OpenRouter returns real per-token prices as USD strings (e.g. "0.0000006") to avoid float
// precision loss. The gateway normalizes them to USD-per-million tokens. This is genuine LIVE
// pricing from the provider — not a static table — so per GATEWAY_GUIDE §6 it is reported as
// source "live". Only when a price is missing/unparseable is it honestly reported as null.
export function getOpenRouterPricing(pricing: OpenRouterApiModel["pricing"]): ModelPricing {
  const input = toPerMillionUsd(pricing?.prompt);
  const output = toPerMillionUsd(pricing?.completion);

  if (input === null && output === null) {
    return {
      inputPerMillionUsd: null,
      outputPerMillionUsd: null,
      source: "unknown",
      note: "OpenRouter returned no usable per-token pricing for this model."
    };
  }

  return {
    inputPerMillionUsd: input,
    outputPerMillionUsd: output,
    source: "live"
  };
}

// OpenRouter prices are per-token USD strings; ×1e6 gives USD per million tokens. A "0" price
// (free models) is a real, meaningful value and is preserved as 0, not treated as unknown.
function toPerMillionUsd(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed * 1_000_000;
}
