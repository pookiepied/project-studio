import { Hono } from "hono";
import { toErrorResponse } from "../../core/errors";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import { getServedCatalog } from "./catalog";

export const modelsRoute = new Hono<{ Bindings: GatewayEnv }>();

modelsRoute.get("/", async (c) => {
  try {
    const catalog = await getServedCatalog(c.env);
    const providers = Object.fromEntries(
      catalog.discovery.map((result) => [
        result.provider,
        {
          provider: result.provider,
          status: result.ok ? "active" : "error",
          apiKeyValid: result.ok,
          modelCount: catalog.models.filter((model) => model.provider === result.provider).length,
          lastChecked: catalog.generatedAt,
          errorMessage: result.error
        }
      ])
    );

    return c.json({
      object: "list",
      generated_at: catalog.generatedAt,
      data: catalog.models,
      discovery: catalog.discovery,
      models: catalog.models,
      providers,
      lastUpdated: catalog.generatedAt,
      totalModels: catalog.models.length,
      uniqueModels: catalog.models.length
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
