import { providers } from "../../core/registry";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import type { CatalogEnvelope } from "../../system/infrastructure/cloudflare/kv";

export async function discoverModels(env: GatewayEnv): Promise<CatalogEnvelope> {
  const settled = await Promise.all(
    providers.map(async (provider) => {
      try {
        return {
          provider: provider.id,
          ok: true as const,
          models: await provider.models({ env })
        };
      } catch (error) {
        return {
          provider: provider.id,
          ok: false as const,
          models: [],
          error: error instanceof Error ? error.message : "Unknown discovery error"
        };
      }
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    models: settled.flatMap((result) => result.models),
    discovery: settled.map(({ provider, ok, error }) => ({ provider, ok, error }))
  };
}
