import { getCatalog } from "../../core/registry";
import type { GatewayEnv } from "../../system/infrastructure/cloudflare/env";
import { readCatalog, writeCatalog, type CatalogEnvelope } from "../../system/infrastructure/cloudflare/kv";
import { discoverModels } from "./discover";

export async function getServedCatalog(env: GatewayEnv): Promise<CatalogEnvelope> {
  const cached = await readCatalog(env);
  if (cached) return cached;

  const models = await getCatalog();
  return {
    generatedAt: new Date(0).toISOString(),
    models,
    discovery: [{ provider: "openai", ok: true }]
  };
}

export async function refreshCatalog(env: GatewayEnv): Promise<CatalogEnvelope> {
  const catalog = await discoverModels(env);
  await writeCatalog(env, catalog);
  return catalog;
}
