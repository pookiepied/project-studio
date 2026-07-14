/**
 * Rate tracker for provider daily budgets.
 *
 * Primary path: gateway service binding — calls gateway's internal rate
 * endpoints which proxy to RateTrackerDurableObject (atomic, serialized).
 *
 * Fallback path: MODELS_KV — used in dev/preview where the GATEWAY binding is
 * absent. Non-atomic but acceptable for non-production traffic.
 */

import { ProviderBudget } from "@gateway/services/router/types";
import { PROVIDER_BUDGETS } from "@gateway/services/router/config";

const KV_TTL_SECONDS = 90000; // ~25 hours (KV fallback only)

function todayKey(kvPrefix: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${kvPrefix}:${yyyy}-${mm}-${dd}`;
}

export class RateTracker {
  constructor(
    private kv: KVNamespace,
    private gateway?: Fetcher
  ) {}

  private budgetFor(provider: string): ProviderBudget | undefined {
    return PROVIDER_BUDGETS.find((b) => b.provider === provider);
  }

  /** Returns true if the provider is under its daily budget. */
  async isUnderBudget(provider: string): Promise<boolean> {
    const budget = this.budgetFor(provider);
    if (!budget) return true;

    if (this.gateway) {
      try {
        const res = await this.gateway.fetch(
          `https://studio-gateway/internal/rate/check?provider=${encodeURIComponent(provider)}`
        );
        if (res.ok) {
          const { underBudget } = await res.json<{ underBudget: boolean }>();
          return underBudget;
        }
      } catch {
        // gateway unavailable — fall through to KV
      }
    }

    const raw = await this.kv.get(todayKey(budget.kvPrefix));
    const count = raw ? parseInt(raw, 10) : 0;
    return count < budget.dailyLimit;
  }

  /** Increments the request counter for the provider. Fire-and-forget safe. */
  async recordRequest(provider: string): Promise<void> {
    const budget = this.budgetFor(provider);
    if (!budget) return;

    if (this.gateway) {
      try {
        await this.gateway.fetch(
          new Request(
            `https://studio-gateway/internal/rate/record?provider=${encodeURIComponent(provider)}`,
            { method: "POST" }
          )
        );
        return;
      } catch {
        // gateway unavailable — fall through to KV
      }
    }

    const key = todayKey(budget.kvPrefix);
    const raw = await this.kv.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    await this.kv.put(key, String(count + 1), { expirationTtl: KV_TTL_SECONDS });
  }
}
