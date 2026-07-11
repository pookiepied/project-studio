import { Hono } from "hono";
import { toErrorResponse } from "../core/errors";
import type { GatewayEnv } from "../system/infrastructure/cloudflare/env";
import { getModelRegistryForEnv } from "./index";

export const modelsRoute = new Hono<{ Bindings: GatewayEnv }>();

modelsRoute.get("/", async (c) => {
  try {
    const registry = await getModelRegistryForEnv(c.env);
    const providers = Object.fromEntries(
      registry.providers.map((provider) => [
        provider.provider,
        {
          provider: provider.provider,
          status: provider.status,
          apiKeyValid: true,
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
  } catch (error) {
    return toErrorResponse(error);
  }
});
