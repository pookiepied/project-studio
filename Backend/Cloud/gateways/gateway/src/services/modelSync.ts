import { GatewayEnv } from "../env";
import { ModelsResponse, ProviderContract } from "../types";
import { ModelDiscovery } from "../discovery/discovery";
import { logger } from "../logger";
import { CACHE_CONFIG } from "../config/constants";

let modelSyncServiceInstance: ModelSyncService | null = null;

export function getModelSyncService(): ModelSyncService {
  if (!modelSyncServiceInstance) {
    modelSyncServiceInstance = new ModelSyncService();
  }
  return modelSyncServiceInstance;
}

export class ModelSyncService {
  /**
   * Sync models from all enabled providers
   * This is called by the cron job every 6 hours
   */
  async syncModels(env: GatewayEnv): Promise<ModelsResponse> {
    logger.info("Starting model sync (cron job)");
    const startTime = Date.now();

    try {
      // Use new discovery system
      const discovery = new ModelDiscovery(env);
      const result = await discovery.discoverAll();

      // Convert to ModelsResponse format
      const allModels = result.providers.flatMap(p => p.models);

      const providers: Record<string, ProviderContract> = {};
      for (const providerResult of result.providers) {
        providers[providerResult.provider] = {
          provider: providerResult.provider,
          status: providerResult.status === "success" ? "active" : "error",
          apiKeyValid: providerResult.status === "success",
          modelCount: providerResult.models.length,
          lastChecked: providerResult.discoveredAt,
          errorMessage: providerResult.errorMessage
        };
      }

      const response: ModelsResponse = {
        models: allModels,
        providers,
        lastUpdated: result.discoveredAt,
        totalModels: result.totalModels,
        uniqueModels: result.totalModels // All models are unique by ID
      };

      // Only cache if we actually got models — never cache an empty result
      if (allModels.length > 0) {
        try {
          const ttlSeconds = Math.floor(CACHE_CONFIG.MODELS_TTL / 1000);
          await env.MODELS_KV.put(CACHE_CONFIG.MODELS_KV_KEY, JSON.stringify(response), {
            expirationTtl: ttlSeconds,
          });
          logger.info(`Saved ${allModels.length} models to KV storage`);

          // Write per-model pricing under separate keys so estimateCostUsd can look them up
          // without reading the full model catalog on every request.
          const pricingWrites = allModels
            .filter(m => m.pricing != null)
            .map(m => env.MODELS_KV.put(
              `pricing:${m.id}`,
              JSON.stringify({ input: m.pricing!.input, output: m.pricing!.output }),
              { expirationTtl: ttlSeconds },
            ));
          await Promise.all(pricingWrites);
          logger.info(`Wrote pricing for ${pricingWrites.length} models to KV`);
        } catch (error) {
          logger.error("Failed to save to KV storage:", error);
        }
      } else {
        logger.warn("Sync returned 0 models — skipping KV write to avoid caching empty state");
      }

      const duration = Date.now() - startTime;
      logger.info(
        `Model sync complete: ${response.totalModels} models from ${Object.keys(providers).length} providers (${duration}ms)`
      );

      return response;
    } catch (error) {
      logger.error("Model sync failed:", error);
      throw error;
    }
  }

  /**
    * Get cached models from KV storage
    * Falls back to hardcoded models if KV fails
    */
  async getCachedModels(env: GatewayEnv): Promise<ModelsResponse | null> {
    try {
      const cached = await env.MODELS_KV.get(CACHE_CONFIG.MODELS_KV_KEY, "json");
      if (cached) {
        logger.info("Retrieved models from KV cache");
        return cached as ModelsResponse;
      }
    } catch (error) {
      logger.error("Failed to get cached models:", error);
    }
    return null;
  }

}
