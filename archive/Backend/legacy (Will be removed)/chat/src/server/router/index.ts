/**
 * Auto-router entry point.
 *
 * Usage in chat.ts:
 *
 *   import { createRouter } from "../services/router";
 *
 *   if (body.model === "auto") {
 *     const router = createRouter(env.MODELS_KV);
 *     const decision = await router.decide({ messages: body.messages });
 *     body.model = decision.model;
 *     // emit auto_routed SSE event before streaming
 *   }
 *
 *   // After a successful response:
 *   await router.recordRequest(decision);
 */

import { GatewayEnv } from "../../gatewayEnv";
import { RouterDecision, ClassifyInput } from "@gateway/services/router/types";
import { AUTO_MODE, getAutoStaticModel, getTierConfig, getEmergencyFallback } from "@gateway/services/router/config";
import { classifyRequest } from "./classifier";
import { RateTracker } from "./rateTracker";
import { AUTO_CONFIG_KV_KEY } from "@gateway/routes/adminModes";

export type { RouterDecision } from "@gateway/services/router/types";

// ---------------------------------------------------------------------------
// Module-level auto-config cache — persists within a warm worker isolate.
// Avoids a KV read on every chat request; TTL keeps config changes responsive.
// ---------------------------------------------------------------------------

interface AutoConfigCache {
  routerMode: "static" | "dynamic";
  staticModel: string;
  expiresAt: number;
}

let _autoConfigCache: AutoConfigCache | null = null;
const AUTO_CONFIG_TTL_MS = 60_000;

export class Router {
  private rateTracker: RateTracker;
  private env?: GatewayEnv;

  constructor(kv: KVNamespace, gateway?: Fetcher, env?: GatewayEnv) {
    this.rateTracker = new RateTracker(kv, gateway);
    this.env = env;
  }

  /**
   * Resolve the effective auto-router config.
   * Checks the module-level cache first (60s TTL), then KV.
   */
  private async resolveAutoConfig(): Promise<{ routerMode: "static" | "dynamic"; staticModel: string }> {
    const now = Date.now();

    if (_autoConfigCache && _autoConfigCache.expiresAt > now) {
      return { routerMode: _autoConfigCache.routerMode, staticModel: _autoConfigCache.staticModel };
    }

    let routerMode: "static" | "dynamic" = AUTO_MODE;
    let staticModel = getAutoStaticModel(this.env);

    try {
      const raw = await this.env?.MODELS_KV.get(AUTO_CONFIG_KV_KEY);
      if (raw) {
        const cfg = JSON.parse(raw) as { routerMode?: string; staticModel?: string };
        if (cfg.routerMode === "static" || cfg.routerMode === "dynamic") routerMode = cfg.routerMode;
        if (typeof cfg.staticModel === "string" && cfg.staticModel) staticModel = cfg.staticModel;
      }
    } catch {
      // KV unavailable — fall back to compiled defaults
    }

    _autoConfigCache = { routerMode, staticModel, expiresAt: now + AUTO_CONFIG_TTL_MS };
    return { routerMode, staticModel };
  }

  /**
   * Decide which model to use for this request.
   *
   * In "static" mode: returns the static model (KV override → env secret → hardcoded default).
   * In "dynamic" mode: classifies the conversation, checks rate budgets,
   * and falls back through the tier chain as needed.
   */
  async decide(input: ClassifyInput): Promise<RouterDecision> {
    const { routerMode, staticModel } = await this.resolveAutoConfig();

    if (routerMode === "static") {
      return { tier: "standard", model: staticModel, usedFallback: false, usedEmergency: false };
    }

    const tier = classifyRequest(input);
    const tierConfig = getTierConfig(this.env);
    const config = tierConfig[tier];

    const primaryProvider = config.primary.split(":")[0];
    const primaryUnderBudget = await this.rateTracker.isUnderBudget(primaryProvider);

    if (primaryUnderBudget) {
      return { tier, model: config.primary, usedFallback: false, usedEmergency: false };
    }

    const fallbackProvider = config.fallback.split(":")[0];
    const fallbackUnderBudget = await this.rateTracker.isUnderBudget(fallbackProvider);

    if (fallbackUnderBudget) {
      return { tier, model: config.fallback, usedFallback: true, usedEmergency: false };
    }

    return { tier, model: getEmergencyFallback(this.env), usedFallback: true, usedEmergency: true };
  }

  /**
   * Record a successful request for rate tracking.
   * Call this after the response stream completes without error.
   */
  async recordRequest(decision: RouterDecision): Promise<void> {
    const provider = decision.model.split(":")[0];
    await this.rateTracker.recordRequest(provider);
  }
}

export function createRouter(kv: KVNamespace, gateway?: Fetcher, env?: GatewayEnv): Router {
  return new Router(kv, gateway, env);
}
