import type { GatewayEnv } from "@/platform/cloudflare/environment";
import {
  cloudflareGatewayTransport,
  type TransportConfig
} from "./transport";
import { withCloudflareGatewayFetch } from "./headers";

// Every provider is reached through Cloudflare AI Gateway. Provider credentials are configured
// centrally by the operator using Cloudflare's stored-key feature (named BYOK by Cloudflare).
// This is not an end-user BYOK transport: requests cannot supply or select a provider key.
export function getTransport(provider: string, env: GatewayEnv, fetchImpl?: typeof fetch): TransportConfig {
  const transport = cloudflareGatewayTransport(provider, env);
  return {
    ...transport,
    fetch: withCloudflareGatewayFetch(fetchImpl)
  };
}
