import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import {
  cloudflareGatewayTransport,
  withCloudflareGatewayFetch,
  type TransportConfig
} from "./cloudflareGateway";

// Every gateway provider is reached through Cloudflare AI Gateway (BYOK). There is no
// direct-key transport: provider keys live in Cloudflare and are injected by the gateway,
// so the worker only ever sends cf-aig-* headers (and strips any provider auth).
export function getTransport(provider: string, env: GatewayEnv, fetchImpl?: typeof fetch): TransportConfig {
  const transport = cloudflareGatewayTransport(provider, env);
  return {
    ...transport,
    fetch: withCloudflareGatewayFetch(fetchImpl)
  };
}
