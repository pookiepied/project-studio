import type { GatewayWorkerEnv } from "../env";
import { PROVIDER_BUDGETS } from "../services/router/config";

const KV_TTL_SECONDS = 90000; // ~25 hours

function todayKey(kvPrefix: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  return `${kvPrefix}:${yyyy}-${mm}-${dd}`;
}

function doStub(env: GatewayWorkerEnv, kvPrefix: string): DurableObjectStub | null {
  if (!env.RATE_TRACKER_DO) return null;
  return env.RATE_TRACKER_DO.get(env.RATE_TRACKER_DO.idFromName(kvPrefix));
}

/** GET /internal/rate/check?provider=X → { underBudget: boolean } */
export async function handleRateCheck(provider: string, env: GatewayWorkerEnv): Promise<Response> {
  const budget = PROVIDER_BUDGETS.find((b) => b.provider === provider);
  if (!budget) return Response.json({ underBudget: true });

  const stub = doStub(env, budget.kvPrefix);
  if (stub) {
    try {
      const res   = await stub.fetch(`https://do/count?key=${encodeURIComponent(budget.kvPrefix)}`);
      const { count } = await res.json<{ count: number }>();
      return Response.json({ underBudget: count < budget.dailyLimit });
    } catch {
      // DO unreachable — fall through to KV
    }
  }

  const raw   = await env.MODELS_KV.get(todayKey(budget.kvPrefix));
  const count = raw ? parseInt(raw, 10) : 0;
  return Response.json({ underBudget: count < budget.dailyLimit });
}

/** POST /internal/rate/record?provider=X → { ok: true } */
export async function handleRateRecord(provider: string, env: GatewayWorkerEnv): Promise<Response> {
  const budget = PROVIDER_BUDGETS.find((b) => b.provider === provider);
  if (!budget) return Response.json({ ok: true });

  const stub = doStub(env, budget.kvPrefix);
  if (stub) {
    try {
      await stub.fetch(
        new Request(`https://do/increment?key=${encodeURIComponent(budget.kvPrefix)}`, { method: "POST" })
      );
      return Response.json({ ok: true });
    } catch {
      // DO unreachable — fall through to KV
    }
  }

  const key   = todayKey(budget.kvPrefix);
  const raw   = await env.MODELS_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  await env.MODELS_KV.put(key, String(count + 1), { expirationTtl: KV_TTL_SECONDS });
  return Response.json({ ok: true });
}
