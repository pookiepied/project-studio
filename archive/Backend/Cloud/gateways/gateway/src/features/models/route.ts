import { Hono } from "hono";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { getModelCatalog } from "@/domain/catalog";

export const modelsRoute = new Hono<{ Bindings: GatewayEnv }>();

modelsRoute.get("/", (c) => {
  const registry = getModelCatalog();
  const providers = Object.fromEntries(
    registry.providers.map((provider) => [
      provider.provider,
      {
        provider: provider.provider,
        status: provider.status,
        credentialStatus: "not_probed",
        apiKeyValid: null,
        modelCount: provider.modelCount,
        categories: provider.categories,
        lastChecked: registry.generatedAt
      }
    ])
  );

  return c.json({
      object: "list",
      generated_at: registry.generatedAt,
      registryVersion: registry.version,
      source: registry.source,
      data: registry.models,
      models: registry.models,
      providers,
      lastUpdated: registry.generatedAt,
      totalModels: registry.models.length,
      uniqueModels: registry.models.length
  });
});
