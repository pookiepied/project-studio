import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";

export interface DirectKeyConfig {
  baseURL: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
}

export function directKeyTransport(provider: string, _env: GatewayEnv): DirectKeyConfig {
  throw new Error(`Direct-key transport is not configured for provider ${provider}.`);
}
