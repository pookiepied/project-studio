import type { GatewayEnv } from "@/platform/cloudflare/environment";
import { GatewayError } from "@/platform/errors";
import { getCloudflareProviderRoute } from "./providerRoutes";

export interface TransportConfig {
  baseURL: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
}

export function cloudflareGatewayTransport(provider: string, env: GatewayEnv): TransportConfig {
  if (!env.CF_ACCOUNT_ID) {
    throw new GatewayError("CONFIGURATION_ERROR", "Cloudflare AI Gateway transport is not configured.");
  }
  if (!env.CF_AIG_TOKEN) {
    throw new GatewayError("CONFIGURATION_ERROR", "Cloudflare AI Gateway transport is not configured.");
  }

  const gatewayName = env.CF_AIG_GATEWAY_NAME || "studio-gateway";
  const alias = env.CF_AIG_BYOK_ALIAS || "production";
  const route = getCloudflareProviderRoute(provider);
  return {
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${gatewayName}/${route.slug}${route.basePath}`,
    headers: {
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "cf-aig-byok-alias": alias
    },
    fetch
  };
}

export { getCloudflareProviderRoute } from "./providerRoutes";
