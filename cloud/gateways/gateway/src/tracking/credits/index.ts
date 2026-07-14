/**
 * Provider credit balance fetcher.
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 *
 * Only ONE provider is registered here: OpenRouter.
 *
 * This is not an oversight — it reflects the state of provider APIs as of
 * May 2026. Every other provider in the system has been researched and none
 * of them expose a public credit balance endpoint:
 *
 *   Groq         — No credit API. Feature request open on community forum
 *                  since 2024, still not shipped.
 *   Google       — No credit API. Billing is managed in Google Cloud Console
 *                  only (no programmatic balance query).
 *   Alibaba      — No credit API. DashScope billing is in the Alibaba Cloud
 *                  console only.
 *   MiniMax      — No credit API. Balance visible in the web dashboard only.
 *   Mistral      — No credit API. Billing through La Plateforme dashboard.
 *   XAI (Grok)   — No credit API. Billing through console.x.ai only.
 *   Cerebras     — No credit API. Billing through dashboard only.
 *   DeepSeek     — No credit API. Balance in platform.deepseek.com only.
 *   Cohere       — No credit API. Billing through dashboard.cohere.com only.
 *   Perplexity   — No credit API. Billing through perplexity.ai/settings only.
 *
 * For ALL providers that lack a credit API, cost visibility comes from the
 * estimated_cost_usd field in usage_events, calculated from token counts ×
 * the pricing table in tracking/pricing.ts. This is the correct solution.
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *
 *   fetchAllCredits(env)
 *     → OpenRouterCreditProvider.fetch(apiKey)
 *       → GET https://openrouter.ai/api/v1/auth/key
 *     → write to tracker:  POST /ingest/credits
 *     → cached in KV for 15 minutes (CREDITS_KV)
 *     → on fetch failure:  read last known value from tracker GET /usage/credits
 *
 * ── When to call ────────────────────────────────────────────────────────────
 *
 *   Called by the chat worker's 15-minute cron job (chat/src/index.ts).
 *   The KV cache prevents hammering the OpenRouter API on every tick.
 */

import type { GatewayEnv }                          from '../../env';
import { getApiKey }                                 from '../../providers';
import type { CreditProvider, ProviderCreditResult } from './base';
import { OpenRouterCreditProvider }                  from './openrouter';

/**
 * The only registered credit provider.
 * Add others here IF AND WHEN they expose a public credit balance API.
 */
const CREDIT_PROVIDERS: CreditProvider[] = [
  new OpenRouterCreditProvider(),
];

/** KV cache TTL — 15 minutes prevents excessive calls to the OpenRouter API. */
const CACHE_TTL_SECONDS = 900;

/**
 * Fetch current credit balances for all providers that support it.
 *
 * Results are written to the tracker worker for historical tracking and
 * cached in KV for CACHE_TTL_SECONDS. On failure, falls back to the last
 * known value from the tracker.
 *
 * @returns Array of results, one per supported provider. Currently always
 *          length 0 or 1 (only OpenRouter).
 */
export async function fetchAllCredits(env: GatewayEnv): Promise<ProviderCreditResult[]> {
  const results: ProviderCreditResult[] = [];

  for (const provider of CREDIT_PROVIDERS) {
    const apiKey = getApiKey(env, provider.providerName);
    if (!apiKey) continue;

    const cacheKey = `credits:${provider.providerName}`;

    // Serve from KV cache when available (avoids hitting the provider API
    // on every Activity Dashboard load)
    if (env.CREDITS_KV) {
      const cached = await env.CREDITS_KV.get(cacheKey);
      if (cached) {
        try {
          results.push(JSON.parse(cached) as ProviderCreditResult);
          continue;
        } catch {
          /* cache miss or corrupt entry — fall through to fetch fresh */
        }
      }
    }

    try {
      const result = await provider.fetch(apiKey);

      // Persist in KV for next request
      if (env.CREDITS_KV) {
        await env.CREDITS_KV.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL_SECONDS,
        });
      }

      // Write balance snapshot to tracker for historical credit tracking
      if (env.TRACKER) {
        env.TRACKER.fetch("https://tracker/ingest/credits", {
          method:  "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider:      result.provider,
            balance_usd:   result.balance_usd,
            used_usd:      result.used_usd,
            purchased_usd: result.purchased_usd,
            raw_response:  result.raw_response,
            updated_at:    result.fetched_at,
          }),
        }).catch(() => {});
      }

      results.push(result);
    } catch (err) {
      // On fetch failure, return last known balance from tracker so the
      // dashboard shows stale data rather than an empty state
      if (env.TRACKER) {
        try {
          const resp = await env.TRACKER.fetch("https://tracker/usage/credits");
          if (resp.ok) {
            const data = await resp.json() as { credits: Record<string, unknown>[] };
            const row  = data.credits?.find(r => r.provider === provider.providerName);
            if (row) {
              results.push({
                provider:      row.provider      as string,
                balance_usd:   row.balance_usd   as number | null,
                used_usd:      row.used_usd      as number | null,
                purchased_usd: row.purchased_usd as number | null,
                supported:     true,
                raw_response:  null,
                fetched_at:    row.updated_at    as string,
                error: err instanceof Error ? err.message : "fetch failed",
              });
            }
          }
        } catch {
          /* ignore fallback failure — return empty rather than throw */
        }
      }
    }
  }

  return results;
}
