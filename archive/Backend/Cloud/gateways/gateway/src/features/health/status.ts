import { getModelCatalog } from "@/domain/catalog";
import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { getCloudflareProviderRoute } from "@/platform/cloudflare/aiGateway/providerRoutes";
import { providers } from "@/providers/registry";

const startedAt = Date.now();
const version = "0.2.0";

export function getLiveness(env: GatewayEnv) {
  return {
    ok: true,
    status: "alive",
    service: "studio-gateway",
    version,
    environment: env.ENVIRONMENT || "development",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString()
  };
}

export function getReadiness(env: GatewayEnv) {
  const configuration = getConfigurationHealth(env);
  const ready = configuration.missing.length === 0;
  return {
    ready,
    body: {
      ok: ready,
      status: ready ? "ready" : "not_ready",
      service: "studio-gateway",
      version,
      configuration
    }
  };
}

export function getProviderHealth(env: GatewayEnv) {
  const catalog = getModelCatalog();
  const configured = getConfigurationHealth(env).missing.length === 0;
  return {
    ok: configured,
    status: configured ? "configured" : "not_configured",
    probeMode: "configuration",
    note: "This endpoint does not issue paid provider requests.",
    providers: providers.map((provider) => {
      const route = getCloudflareProviderRoute(provider.id);
      const providerCatalog = catalog.providers.find((candidate) => candidate.provider === provider.id);
      const capabilities = Array.from(
        new Set(
          catalog.models
            .filter((model) => model.provider === provider.id)
            .flatMap((model) => model.capabilities.modalities)
        )
      );
      return {
        id: provider.id,
        status: configured ? "configured" : "not_configured",
        capabilities,
        adapterCapabilities: provider.capabilities,
        unexposedAdapterCapabilities: provider.capabilities.filter(
          (capability) => !capabilities.includes(capability)
        ),
        modelCount: providerCatalog?.modelCount ?? 0,
        categories: providerCatalog?.categories ?? [],
        transport: {
          kind: "cloudflare-ai-gateway",
          mode: route.mode,
          slug: route.slug,
          basePath: route.basePath
        }
      };
    })
  };
}

function getConfigurationHealth(env: GatewayEnv) {
  const missing = [
    !env.CF_ACCOUNT_ID ? "CF_ACCOUNT_ID" : undefined,
    !env.CF_AIG_TOKEN ? "CF_AIG_TOKEN" : undefined
  ].filter((name): name is string => Boolean(name));

  return {
    configured: missing.length === 0,
    missing,
    gateway: env.CF_AIG_GATEWAY_NAME || "studio-gateway",
    byokAlias: env.CF_AIG_BYOK_ALIAS || "production"
  };
}
