/**
 * GET /v1/provider-balance/:provider
 *
 * Returns remaining balance/credits for a provider where the API supports it.
 * Currently only OpenRouter exposes a balance endpoint.
 *
 * Response:
 *   { provider, balance_usd, used_usd, purchased_usd, supported }
 *   When not supported: { provider, supported: false, balance_usd: null }
 */

import type { GatewayEnv }     from "../env";
import { createErrorResponse } from "../middleware/response";
import { addCORSHeaders }      from "../middleware/cors";

interface BalanceResult {
  provider:      string;
  supported:     boolean;
  balance_usd:   number | null;
  used_usd?:     number;
  purchased_usd?: number;
  fetched_at:    string;
}

export async function handleProviderBalance(
  provider: string,
  env:      GatewayEnv,
): Promise<Response> {
  try {
    const result = await fetchBalance(provider, env);
    return addCORSHeaders(new Response(JSON.stringify(result), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return addCORSHeaders(createErrorResponse(
      `Failed to fetch balance for '${provider}': ${msg}`,
      500, "api_error",
    ));
  }
}

async function fetchBalance(provider: string, env: GatewayEnv): Promise<BalanceResult> {
  const now = new Date().toISOString();

  switch (provider) {
    case "openrouter": {
      if (!env.OPENROUTER_API_KEY) {
        return { provider, supported: true, balance_usd: null, fetched_at: now };
      }
      const resp = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
        signal:  AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return { provider, supported: true, balance_usd: null, fetched_at: now };
      }
      const json = await resp.json() as {
        data: { total_credits: number; total_usage: number }
      };
      const purchased = json.data.total_credits;
      const used      = json.data.total_usage;
      return {
        provider,
        supported:     true,
        balance_usd:   purchased - used,
        used_usd:      used,
        purchased_usd: purchased,
        fetched_at:    now,
      };
    }

    default:
      return { provider, supported: false, balance_usd: null, fetched_at: now };
  }
}
