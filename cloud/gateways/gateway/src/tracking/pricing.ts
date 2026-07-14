/**
 * Dynamic pricing resolution.
 *
 * Priority order:
 *   1. Provider returns cost directly (OpenRouter: usage.cost is USD)
 *   2. Provider returns token counts + pricing is in MODELS_KV discovery data
 *   3. N/A — null returned; callers display "N/A" rather than $0.00
 *
 * No hardcoded pricing table. Pricing that flows through model discovery
 * (e.g. OpenRouter's /v1/models returns prompt/completion costs per model)
 * is stored in MODELS_KV and fetched here at request time.
 */

import type { GatewayEnv } from "../env";

/**
 * Estimates cost in USD for a completed request.
 *
 * @param directCostUsd   Cost already provided by the provider (e.g. OpenRouter usage.cost).
 * @param model           Full model string — "provider:modelId".
 * @param inputTokens     Prompt token count (null if not available).
 * @param outputTokens    Completion token count (null if not available).
 * @param env             Gateway env — used to read MODELS_KV for stored pricing.
 *
 * Returns null when cost cannot be determined — callers should display "N/A".
 */
export async function estimateCostUsd(
  directCostUsd: number | null | undefined,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  env?: GatewayEnv,
): Promise<number | null> {
  // Provider gave us the cost directly — most accurate
  if (directCostUsd != null) return directCostUsd;

  // No tokens — nothing to calculate
  if (inputTokens == null && outputTokens == null) return null;

  // Look up per-token pricing stored in MODELS_KV by the discovery sync
  if (env?.MODELS_KV) {
    try {
      const stored = await env.MODELS_KV.get<{ input: number; output: number }>(
        `pricing:${model}`,
        "json",
      );
      if (stored != null) {
        const inputCost  = ((inputTokens  ?? 0) / 1_000_000) * stored.input;
        const outputCost = ((outputTokens ?? 0) / 1_000_000) * stored.output;
        return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
      }
    } catch {
      // KV read failure — fall through to N/A
    }
  }

  // Pricing unknown
  return null;
}

/**
 * Synchronous version for callers that cannot await (e.g. in fire-and-forget
 * usage recording). Returns null — any KV-backed pricing must use the async version.
 */
export function estimateCostUsdSync(
  directCostUsd: number | null | undefined,
): number | null {
  return directCostUsd ?? null;
}
